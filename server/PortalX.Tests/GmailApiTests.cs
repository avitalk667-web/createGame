using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Mail;

namespace PortalX.Tests;

/// <summary>
/// A stand-in for Google (OAuth token endpoint, revoke endpoint and Gmail API send) — so the whole flow is tested
/// without a real account. It checks what a real Google would: the PKCE verifier, the refresh token, the bearer token.
/// </summary>
public sealed class FakeGoogle : HttpMessageHandler
{
    public const string RefreshToken = "1//fake-refresh-token-VALUE";
    public string Email { get; set; } = "info.portalx@gmail.com";
    public string Scope { get; set; } = "https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/userinfo.email";
    public bool GiveRefreshToken { get; set; } = true;
    public bool RefreshRevoked { get; set; }
    public bool ExpireAccessTokenOnce { get; set; }
    public HttpStatusCode? SendFailure { get; set; }
    public string SendFailureReason { get; set; } = "backendError";
    public bool BreakConnectionOnSend { get; set; }
    public string? ExpectedChallenge { get; set; }
    public int CodeExchanges, Refreshes, Revokes;
    public readonly ConcurrentBag<string> AccessTokens = new();
    public readonly List<string> SentMime = new();
    private int _n;

    private static HttpResponseMessage Json(HttpStatusCode code, object body) =>
        new(code) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };

    private static string B64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private string NewAccess()
    {
        var t = "ya29.fake-access-" + Interlocked.Increment(ref _n);
        AccessTokens.Add(t);
        return t;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        var url = req.RequestUri!;
        if (url.Host == "oauth2.googleapis.com" && url.AbsolutePath == "/token")
        {
            var form = (await req.Content!.ReadAsStringAsync(ct)).Split('&').Select(kv => kv.Split('='))
                .ToDictionary(kv => Uri.UnescapeDataString(kv[0]), kv => Uri.UnescapeDataString(kv[1].Replace('+', ' ')));
            if (form["client_secret"] != "test-client-secret-VALUE") return Json(HttpStatusCode.Unauthorized, new { error = "invalid_client" });
            if (form["grant_type"] == "authorization_code")
            {
                Interlocked.Increment(ref CodeExchanges);
                // PKCE: the verifier must match the challenge sent to the consent page
                var challenge = B64Url(SHA256.HashData(Encoding.ASCII.GetBytes(form["code_verifier"])));
                if (form["code"] != "good-code" || challenge != ExpectedChallenge) return Json(HttpStatusCode.BadRequest, new { error = "invalid_grant" });
                var idToken = "x." + B64Url(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { email = Email, email_verified = true }))) + ".sig";
                return Json(HttpStatusCode.OK, GiveRefreshToken
                    ? new { access_token = NewAccess(), expires_in = 3599, refresh_token = RefreshToken, scope = Scope, id_token = idToken, token_type = "Bearer" }
                    : (object)new { access_token = NewAccess(), expires_in = 3599, scope = Scope, id_token = idToken, token_type = "Bearer" });
            }
            Interlocked.Increment(ref Refreshes);
            if (RefreshRevoked || form["refresh_token"] != RefreshToken) return Json(HttpStatusCode.BadRequest, new { error = "invalid_grant", error_description = "Token has been expired or revoked." });
            return Json(HttpStatusCode.OK, new { access_token = NewAccess(), expires_in = 3599, scope = Scope, token_type = "Bearer" });
        }
        if (url.Host == "oauth2.googleapis.com" && url.AbsolutePath == "/revoke")
        {
            Interlocked.Increment(ref Revokes);
            return new HttpResponseMessage(HttpStatusCode.OK);
        }
        if (url.Host == "gmail.googleapis.com" && url.AbsolutePath == "/gmail/v1/users/me/messages/send")
        {
            var bearer = req.Headers.Authorization?.Parameter;
            if (ExpireAccessTokenOnce)
            {
                ExpireAccessTokenOnce = false;
                return Json(HttpStatusCode.Unauthorized, new { error = new { code = 401, message = "Invalid Credentials", errors = new[] { new { reason = "authError", message = "x" } } } });
            }
            if (bearer == null || !AccessTokens.Contains(bearer))
                return Json(HttpStatusCode.Unauthorized, new { error = new { code = 401, message = "Invalid Credentials", errors = new[] { new { reason = "authError", message = "x" } } } });
            if (BreakConnectionOnSend) throw new HttpRequestException("connection reset", new IOException("reset"));
            if (SendFailure is { } f)
                return Json(f, new { error = new { code = (int)f, message = "error", errors = new[] { new { reason = SendFailureReason, message = "x" } } } });
            // Google's library may gzip the request body
            var bytes = await req.Content!.ReadAsByteArrayAsync(ct);
            if (req.Content.Headers.ContentEncoding.Contains("gzip"))
            {
                using var gz = new System.IO.Compression.GZipStream(new MemoryStream(bytes), System.IO.Compression.CompressionMode.Decompress);
                using var ms = new MemoryStream();
                await gz.CopyToAsync(ms, ct);
                bytes = ms.ToArray();
            }
            var body = JsonDocument.Parse(bytes).RootElement.GetProperty("raw").GetString()!;
            var raw = Encoding.UTF8.GetString(Convert.FromBase64String(body.Replace('-', '+').Replace('_', '/').PadRight(body.Length + (4 - body.Length % 4) % 4, '=')));
            lock (SentMime) SentMime.Add(raw);
            return Json(HttpStatusCode.OK, new { id = "msg-" + SentMime.Count, threadId = "thread-1", labelIds = new[] { "SENT" } });
        }
        return new HttpResponseMessage(HttpStatusCode.NotFound);
    }
}

public sealed class FakeGoogleHttp(FakeGoogle google) : GoogleHttp
{
    public override HttpMessageHandler Handler => google;
}

/// <summary>Keeps every log line, to prove that no token, code or secret is ever logged.</summary>
public sealed class CapturedLogs : ILoggerProvider
{
    public readonly ConcurrentQueue<string> Lines = new();
    public ILogger CreateLogger(string category) => new L(this);
    public void Dispose() { }
    private sealed class L(CapturedLogs owner) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId id, TState state, Exception? ex, Func<TState, Exception?, string> format) =>
            owner.Lines.Enqueue(format(state, ex) + " " + ex?.Message);
    }
}

/// <summary>Sending through Gmail API with OAuth (Gmail API spec, section 14).</summary>
[Collection(DatabaseCollection.Name)]
public class GmailApiTests
{
    private const string ClientSecret = "test-client-secret-VALUE";
    private const string EncryptionKey = "test-encryption-key-0123456789-abcdefghijklmnop";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HubIntegrationTests.Factory _factory;

    public GmailApiTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private (WebApplicationFactory<Program> F, FakeGoogle Google, CapturedLogs Logs) Site(string key = EncryptionKey)
    {
        var google = new FakeGoogle();
        var logs = new CapturedLogs();
        var f = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["GOOGLE_CLIENT_ID"] = "test-client-id.apps.googleusercontent.com",
                ["GOOGLE_CLIENT_SECRET"] = ClientSecret,
                ["GOOGLE_TOKEN_ENCRYPTION_KEY"] = key,
                ["PORTALX_SITE_URL"] = "https://portalx.test",
                ["RateLimits:ResultsEmailPer10Minutes"] = "100000",
                ["RateLimits:EmailAdminPer10Minutes"] = "100000",
            }));
            b.ConfigureLogging(l => l.AddProvider(logs));
            b.ConfigureTestServices(s => s.AddSingleton<GoogleHttp>(new FakeGoogleHttp(google)));
        });
        return (f, google, logs);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>(Json);

    private static async Task<HttpClient> AdminAsync(WebApplicationFactory<Program> f)
    {
        var http = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, BaseAddress = new Uri("https://localhost") });
        (await http.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        http.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return http;
    }

    private static async Task ResetAccountAsync(WebApplicationFactory<Program> f)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        await db.MailAccounts.ExecuteDeleteAsync();
    }

    /// <summary>Starts the authorization as the admin; returns the consent page's query and the state.</summary>
    private static async Task<(Dictionary<string, string> Query, string State)> StartAsync(HttpClient admin, FakeGoogle google)
    {
        var start = await Body(await admin.PostAsync("/api/admin/email/google/start", null));
        var url = new Uri(start.GetProperty("url").GetString()!);
        var q = url.Query.TrimStart('?').Split('&').Select(kv => kv.Split('=')).ToDictionary(kv => kv[0], kv => Uri.UnescapeDataString(kv[1]));
        google.ExpectedChallenge = q["code_challenge"];
        return (q, q["state"]);
    }

    private static async Task<string> CallbackAsync(HttpClient browser, string query)
    {
        var r = await browser.GetAsync("/api/admin/email/google/callback?" + query);
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        var loc = r.Headers.Location!.ToString();
        Assert.StartsWith("/admin?tab=email-setup&gmail=", loc);
        return Uri.UnescapeDataString(loc.Split("gmail=")[1]);
    }

    private static async Task<HttpClient> ConnectAsync(WebApplicationFactory<Program> f, FakeGoogle google)
    {
        await ResetAccountAsync(f);
        var admin = await AdminAsync(f);
        var (_, state) = await StartAsync(admin, google);
        Assert.Equal("connected", await CallbackAsync(admin, $"state={state}&code=good-code&scope=x"));
        return admin;
    }

    // 1, 2, 4 — the authorization: PKCE, only the sending scope, the account checked, the refresh token sealed
    [Fact]
    public async Task Connecting_through_the_admin_stores_an_encrypted_grant_for_the_right_account()
    {
        var (f, google, logs) = Site();
        using var _ = f;
        await ResetAccountAsync(f);
        var admin = await AdminAsync(f);

        var before = await Body(await admin.GetAsync("/api/admin/email/status"));
        Assert.True(before.GetProperty("configured").GetBoolean());
        Assert.False(before.GetProperty("connected").GetBoolean());
        Assert.Equal("https://portalx.test/api/admin/email/google/callback", before.GetProperty("redirectUri").GetString());

        var (q, state) = await StartAsync(admin, google);
        Assert.Equal("https://www.googleapis.com/auth/gmail.send openid email", q["scope"]);
        Assert.DoesNotContain("readonly", q["scope"]);
        Assert.DoesNotContain("mail.google.com", q["scope"]);
        Assert.Equal("S256", q["code_challenge_method"]);
        Assert.Equal("offline", q["access_type"]);
        Assert.Equal("https://portalx.test/api/admin/email/google/callback", q["redirect_uri"]);

        Assert.Equal("connected", await CallbackAsync(admin, $"state={state}&code=good-code"));
        Assert.Equal(1, google.CodeExchanges);

        var acc = await Db(f, db => db.MailAccounts.AsNoTracking().SingleAsync());
        Assert.Equal(MailAccountStatus.Connected, acc.Status);
        Assert.Equal("info.portalx@gmail.com", acc.Email);
        Assert.DoesNotContain(FakeGoogle.RefreshToken, acc.EncryptedRefreshToken);
        Assert.StartsWith("v1.", acc.EncryptedRefreshToken);
        var protector = new TokenProtector(new GoogleMailOptions { EncryptionKey = EncryptionKey });
        Assert.Equal(FakeGoogle.RefreshToken, protector.Open(acc.EncryptedRefreshToken!, "info.portalx@gmail.com"));
        // sealed to this account and this key only
        Assert.Null(protector.Open(acc.EncryptedRefreshToken!, "other@gmail.com"));
        Assert.Null(new TokenProtector(new GoogleMailOptions { EncryptionKey = EncryptionKey + "x" }).Open(acc.EncryptedRefreshToken!, "info.portalx@gmail.com"));

        var after = await admin.GetStringAsync("/api/admin/email/status");
        Assert.Contains("\"connected\":true", after);
        AssertNoSecrets(after, google);
        Assert.True((await Body(await f.CreateClient().GetAsync("/api/site"))).GetProperty("resultsEmail").GetBoolean());
        AssertNoSecrets(string.Join("\n", logs.Lines), google);
    }

    // 3 — the callback refuses a missing, unknown, replayed, expired or foreign state, and a cancelled consent
    [Fact]
    public async Task The_callback_refuses_bad_states_and_never_reports_success_for_them()
    {
        var (f, google, _) = Site();
        using var __ = f;
        await ResetAccountAsync(f);
        var admin = await AdminAsync(f);
        Assert.Equal("bad-state", await CallbackAsync(admin, "code=good-code"));
        Assert.Equal("bad-state", await CallbackAsync(admin, "state=made-up&code=good-code"));

        // another browser (no binding cookie) cannot complete the admin's authorization
        var (_, s1) = await StartAsync(admin, google);
        var stranger = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        Assert.Equal("bad-state", await CallbackAsync(stranger, $"state={s1}&code=good-code"));
        // and the state is now used up
        Assert.Equal("used-state", await CallbackAsync(admin, $"state={s1}&code=good-code"));

        var (_, s2) = await StartAsync(admin, google);
        Assert.Equal("denied", await CallbackAsync(admin, $"state={s2}&error=access_denied"));

        var (_, s3) = await StartAsync(admin, google);
        await Db(f, db => db.OAuthStates.Where(x => x.StateHash == GmailAccount.Hash(s3)).ExecuteUpdateAsync(x => x.SetProperty(y => y.ExpiresAt, DateTime.UtcNow.AddMinutes(-1))));
        Assert.Equal("expired-state", await CallbackAsync(admin, $"state={s3}&code=good-code"));

        var (_, s4) = await StartAsync(admin, google);
        Assert.Equal("connected", await CallbackAsync(admin, $"state={s4}&code=good-code"));
        Assert.Equal("used-state", await CallbackAsync(admin, $"state={s4}&code=good-code"));

        Assert.Equal(1, google.CodeExchanges); // no code was exchanged for any refused callback
    }

    [Fact]
    public async Task Another_mailbox_or_a_missing_permission_is_not_connected()
    {
        var (f, google, _) = Site();
        using var __ = f;
        await ResetAccountAsync(f);
        var admin = await AdminAsync(f);

        google.Email = "someone.else@gmail.com";
        var (_, s1) = await StartAsync(admin, google);
        Assert.Equal("wrong-account", await CallbackAsync(admin, $"state={s1}&code=good-code"));
        Assert.Equal(1, google.Revokes);
        Assert.False(await Db(f, db => db.MailAccounts.AnyAsync(a => a.Status == MailAccountStatus.Connected)));

        google.Email = "info.portalx@gmail.com";
        google.Scope = "openid https://www.googleapis.com/auth/userinfo.email";
        var (_, s2) = await StartAsync(admin, google);
        Assert.Equal("missing-scope", await CallbackAsync(admin, $"state={s2}&code=good-code"));

        google.Scope = "https://www.googleapis.com/auth/gmail.send openid email";
        google.GiveRefreshToken = false;
        var (_, s3) = await StartAsync(admin, google);
        Assert.Equal("no-refresh-token", await CallbackAsync(admin, $"state={s3}&code=good-code"));
        Assert.False((await Body(await admin.GetAsync("/api/admin/email/status"))).GetProperty("connected").GetBoolean());
    }

    // 7 — the admin's explicit test email
    [Fact]
    public async Task The_admin_test_email_goes_to_the_site_mailbox_through_gmail_api()
    {
        var (f, google, logs) = Site();
        using var _ = f;
        var anon = await f.CreateClient().PostAsync("/api/admin/email/test", null);
        Assert.True(anon.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden);

        var admin = await ConnectAsync(f, google);
        var r = await admin.PostAsync("/api/admin/email/test", null);
        var text = await r.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("msg-1", text);
        AssertNoSecrets(text, google);
        var mime = Assert.Single(google.SentMime);
        Assert.Contains("To: <info.portalx@gmail.com>", mime);
        Assert.Contains("From: =?UTF-8?B?", mime);
        Assert.Contains("<info.portalx@gmail.com>", mime);
        Assert.Contains("multipart/alternative", mime);
        Assert.NotNull((await Db(f, db => db.MailAccounts.AsNoTracking().SingleAsync())).LastTestSentAt);
        AssertNoSecrets(string.Join("\n", logs.Lines), google);
    }

    // 5, 6 — an expired access token is renewed; a revoked grant asks for reconnecting and stops offering mail
    [Fact]
    public async Task Expired_access_is_renewed_and_a_revoked_grant_asks_to_reconnect()
    {
        var (f, google, _) = Site();
        using var _ = f;
        var admin = await ConnectAsync(f, google);

        google.ExpireAccessTokenOnce = true;
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync("/api/admin/email/test", null)).StatusCode);
        Assert.Equal(1, google.Refreshes);
        Assert.Single(google.SentMime);

        google.RefreshRevoked = true;
        google.ExpireAccessTokenOnce = true;
        var r = await admin.PostAsync("/api/admin/email/test", null);
        Assert.Equal(HttpStatusCode.BadGateway, r.StatusCode);
        Assert.Equal("needs-reconnect", (await Body(r)).GetProperty("code").GetString());
        var status = await Body(await admin.GetAsync("/api/admin/email/status"));
        Assert.True(status.GetProperty("needsReconnect").GetBoolean());
        Assert.Equal("invalid_grant", status.GetProperty("lastError").GetString());
        Assert.False((await Body(await f.CreateClient().GetAsync("/api/site"))).GetProperty("resultsEmail").GetBoolean());
        Assert.Single(google.SentMime);
    }

    [Fact]
    public async Task A_changed_encryption_key_needs_a_new_connection()
    {
        var (f, google, _) = Site();
        using (f) await ConnectAsync(f, google);
        var (f2, google2, _) = Site(EncryptionKey + "-rotated");
        using var __ = f2;
        var admin = await AdminAsync(f2);
        var status = await Body(await admin.GetAsync("/api/admin/email/status"));
        Assert.False(status.GetProperty("connected").GetBoolean());
        Assert.True(status.GetProperty("needsReconnect").GetBoolean());
        Assert.Equal("key-changed", status.GetProperty("lastError").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync("/api/admin/email/test", null)).StatusCode);
        Assert.Empty(google2.SentMime);
    }

    // 8, 9, 10, 16 — real game results through Gmail API; success only with Gmail's confirmation
    [Fact]
    public async Task Game_results_go_out_through_gmail_and_success_is_shown_only_after_confirmation()
    {
        var (f, google, logs) = Site();
        using var _ = f;
        await ConnectAsync(f, google);
        var (code, seats) = await ResultsEmailTests.FinishedGameAsync(f, "hanukkah-oil");

        // Gmail fails first: no success, recorded as failed, the player may retry
        google.SendFailure = HttpStatusCode.InternalServerError;
        var fail = await Body(await Ask(f, code, seats[0].Token, "player.one@example.org"));
        Assert.False(fail.GetProperty("ok").GetBoolean());
        Assert.Equal("send-failed", fail.GetProperty("code").GetString());
        var req = await Db(f, db => db.ResultEmailRequests.AsNoTracking().SingleAsync(x => x.PlayerId == seats[0].Id));
        Assert.Equal(ResultEmailStatus.Failed, req.Status);
        Assert.Null(req.ProviderMessageId);
        Assert.Equal("google-error", req.LastError);
        Assert.Empty(google.SentMime);

        google.SendFailure = null;
        var ok = await Body(await Ask(f, code, seats[0].Token, "player.one@example.org"));
        Assert.True(ok.GetProperty("ok").GetBoolean());
        Assert.Equal("sent", ok.GetProperty("resultsStatus").GetString());
        req = await Db(f, db => db.ResultEmailRequests.AsNoTracking().SingleAsync(x => x.PlayerId == seats[0].Id));
        Assert.Equal(ResultEmailStatus.Sent, req.Status);
        Assert.Equal("msg-1", req.ProviderMessageId);

        var mime = Assert.Single(google.SentMime);
        Assert.Contains("To: <player.one@example.org>", mime);
        var html = DecodeHtml(mime);
        Assert.Contains(">125<", html);
        Assert.Contains(">340<", html);
        Assert.Contains("21:05", html);
        Assert.DoesNotContain("player.two", html);

        // asking again does not send again
        Assert.Equal("already-sent", (await Body(await Ask(f, code, seats[0].Token, "player.one@example.org"))).GetProperty("code").GetString());
        Assert.Single(google.SentMime);
        AssertNoSecrets(string.Join("\n", logs.Lines), google);
        Assert.DoesNotContain("player.one@example.org", string.Join("\n", logs.Lines));
    }

    [Fact]
    public async Task A_broken_connection_after_sending_is_uncertain_and_not_resent_automatically()
    {
        var (f, google, _) = Site();
        using var _ = f;
        await ConnectAsync(f, google);
        var (code, seats) = await ResultsEmailTests.FinishedGameAsync(f, "gate-of-secrets");
        google.BreakConnectionOnSend = true;
        var r = await Body(await Ask(f, code, seats[0].Token, "player.x@example.org"));
        Assert.False(r.GetProperty("ok").GetBoolean());
        Assert.Equal("send-uncertain", r.GetProperty("code").GetString());
        var req = await Db(f, db => db.ResultEmailRequests.AsNoTracking().SingleAsync(x => x.PlayerId == seats[0].Id));
        Assert.Equal(ResultEmailStatus.Uncertain, req.Status);
        Assert.Equal(1, req.Attempts);
    }

    [Fact]
    public async Task Without_oauth_settings_nothing_is_offered_or_sent()
    {
        var http = _factory.CreateClient();
        Assert.False((await Body(await http.GetAsync("/api/site"))).GetProperty("resultsEmail").GetBoolean());
        var admin = await AdminAsync(_factory);
        var status = await Body(await admin.GetAsync("/api/admin/email/status"));
        Assert.False(status.GetProperty("configured").GetBoolean());
        var missing = status.GetProperty("missing").EnumerateArray().Select(x => x.GetString()).ToList();
        Assert.Contains("GOOGLE_CLIENT_ID", missing);
        Assert.Contains("GOOGLE_TOKEN_ENCRYPTION_KEY", missing);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync("/api/admin/email/google/start", null)).StatusCode);
        Assert.True((await http.GetAsync("/api/admin/email/status")).StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden);
    }

    [Theory]
    [InlineData("https://portal-x-scfm.onrender.com/api/admin/email/google/callback", true)]
    [InlineData("http://portal-x-scfm.onrender.com/api/admin/email/google/callback", false)]
    [InlineData("https://portal-x-scfm.onrender.com/elsewhere", false)]
    [InlineData("http://localhost:5080/api/admin/email/google/callback", true)]
    public void Only_an_https_callback_on_the_right_path_is_accepted(string uri, bool accepted)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["GOOGLE_REDIRECT_URI"] = uri }).Build();
        var o = GoogleMailOptions.FromConfig(config, SiteOptions.FromConfig(config));
        Assert.Equal(accepted ? uri : null, o.RedirectUri);
    }

    [Fact]
    public void Mime_encodes_headers_and_refuses_injected_recipients()
    {
        var m = new EmailMessage("a@example.org", "תוצאות\r\nBcc: x@evil.test", "<p>שלום</p>", "שלום");
        var text = Mime.Text(m, "PORTAL X", "info.portalx@gmail.com");
        Assert.DoesNotContain("Bcc: x@evil.test", text);
        Assert.Contains("Subject: =?UTF-8?B?", text);
        Assert.Throws<EmailSendException>(() => Mime.Text(m with { To = "a@example.org\r\nBcc: x@evil.test" }, "PORTAL X", "info.portalx@gmail.com"));
    }

    private static Task<HttpResponseMessage> Ask(WebApplicationFactory<Program> f, string code, string token, string email) =>
        f.CreateClient().PostAsJsonAsync($"/api/rooms/{code}/results-email",
            new { token, sendResults = true, email, marketingConsent = false, communityLink = false });

    private static async Task<T> Db<T>(WebApplicationFactory<Program> f, Func<PortalDbContext, Task<T>> q)
    {
        using var scope = f.Services.CreateScope();
        return await q(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    private static string DecodeHtml(string mime)
    {
        var part = mime.Split("Content-Type: text/html; charset=UTF-8")[1];
        var b64 = part.Split("\r\n\r\n", 2)[1].Split("--")[0].Replace("\r\n", "");
        return Encoding.UTF8.GetString(Convert.FromBase64String(b64));
    }

    /// <summary>No refresh token, access token, client secret, authorization code or encryption key in the text.</summary>
    private static void AssertNoSecrets(string text, FakeGoogle google)
    {
        Assert.DoesNotContain(FakeGoogle.RefreshToken, text);
        Assert.DoesNotContain(ClientSecret, text);
        Assert.DoesNotContain(EncryptionKey, text);
        Assert.DoesNotContain("good-code", text);
        foreach (var t in google.AccessTokens) Assert.DoesNotContain(t, text);
    }
}
