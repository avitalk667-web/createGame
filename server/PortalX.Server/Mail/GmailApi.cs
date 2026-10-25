using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Google;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Gmail.v1;
using Google.Apis.Gmail.v1.Data;
using Google.Apis.Services;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Mail;

/// <summary>
/// The HTTP handler used for every call to Google (OAuth token endpoint and Gmail API). Tests replace it with a fake
/// Google; in production it is a normal HTTPS handler — port 443 only, never SMTP.
/// </summary>
public class GoogleHttp
{
    private readonly Lazy<HttpMessageHandler> _handler = new(() => new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(5) });
    public virtual HttpMessageHandler Handler => _handler.Value;
}

/// <summary>Lets Google's .NET client library use <see cref="GoogleHttp"/>'s handler.</summary>
internal sealed class GoogleLibHttpFactory(GoogleHttp http) : Google.Apis.Http.HttpClientFactory
{
    protected override HttpMessageHandler CreateHandler(Google.Apis.Http.CreateHttpClientArgs args) => new NonDisposingHandler(http.Handler);

    private sealed class NonDisposingHandler(HttpMessageHandler inner) : DelegatingHandler(inner)
    {
        protected override void Dispose(bool disposing) { /* the shared handler outlives each client */ }
    }
}

/// <summary>
/// Seals the refresh token with AES-256-GCM (authenticated). The key comes from GOOGLE_TOKEN_ENCRYPTION_KEY (never
/// generated at startup); the mailbox address is bound in as associated data, so a token cannot be moved to another account.
/// </summary>
public sealed class TokenProtector(GoogleMailOptions options)
{
    private byte[] Key => SHA256.HashData(Encoding.UTF8.GetBytes("portalx-gmail-token:" + options.EncryptionKey));

    /// <summary>Identifies the key without revealing it, so a changed key is detected (the stored token then needs reconnecting).</summary>
    public string Fingerprint => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("fp:" + Convert.ToBase64String(Key))))[..16];

    public string Seal(string token, string account)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plain = Encoding.UTF8.GetBytes(token);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using var gcm = new AesGcm(Key, 16);
        gcm.Encrypt(nonce, plain, cipher, tag, Encoding.UTF8.GetBytes(account));
        return "v1." + Convert.ToBase64String(nonce.Concat(tag).Concat(cipher).ToArray());
    }

    /// <summary>The token, or null when the data was changed, sealed for another account or with another key.</summary>
    public string? Open(string sealedToken, string account)
    {
        try
        {
            if (!sealedToken.StartsWith("v1.")) return null;
            var all = Convert.FromBase64String(sealedToken[3..]);
            var cipher = all[28..];
            var plain = new byte[cipher.Length];
            using var gcm = new AesGcm(Key, 16);
            gcm.Decrypt(all[..12], cipher, all[12..28], plain, Encoding.UTF8.GetBytes(account));
            return Encoding.UTF8.GetString(plain);
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or ArgumentException)
        {
            return null;
        }
    }
}

public sealed record MailAccountView(
    bool Configured, IReadOnlyList<string> Missing, string? RedirectUri, string Sender, string Status, bool Connected,
    bool NeedsReconnect, string? LastError, DateTime? LastErrorAt, DateTime? ConnectedAt, DateTime? LastSendAt, DateTime? LastTestSentAt,
    bool SendScopeGranted);

/// <summary>
/// The Gmail mailbox the site sends from: OAuth 2.0 authorization-code flow with PKCE (server side only), the encrypted
/// refresh token in the database (survives restarts), short-lived access tokens in memory, and the send itself through
/// Google's Gmail API library (POST gmail/v1/users/me/messages/send).
/// </summary>
public sealed class GmailAccount(GoogleMailOptions options, TokenProtector protector, GoogleHttp http, IServiceScopeFactory scopes, ILogger<GmailAccount> logger)
{
    public const string AuthEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    public const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    public const string RevokeEndpoint = "https://oauth2.googleapis.com/revoke";
    public const string BindingCookie = "px_gmail_oauth";
    public static readonly TimeSpan StateLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(20);

    private readonly SemaphoreSlim _tokenGate = new(1, 1);
    private string? _accessToken;
    private DateTime _accessTokenExpires;
    private (bool Available, DateTime At)? _availability;

    private HttpClient Client() => new(http.Handler, disposeHandler: false) { Timeout = RequestTimeout };

    private static string RandomToken(int bytes = 32) => Base64Url(RandomNumberGenerator.GetBytes(bytes));
    private static string Base64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static string Hash(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s)));

    // ------------------------------------------------------------------ connecting (admin only)

    /// <summary>Starts an authorization: a single-use state and PKCE verifier are kept on the server; the binding goes in a cookie.</summary>
    public async Task<(string Url, string Binding)> StartAsync(string admin)
    {
        if (!options.Configured) throw new InvalidOperationException("not-configured");
        var state = RandomToken();
        var verifier = RandomToken(48);
        var binding = RandomToken();
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var now = DateTime.UtcNow;
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
            await db.OAuthStates.Where(s => s.ExpiresAt < now.AddDays(-1)).ExecuteDeleteAsync();
            db.OAuthStates.Add(new OAuthState
            {
                StateHash = Hash(state), CodeVerifier = verifier, BindingHash = Hash(binding), AdminName = admin,
                CreatedAt = now, ExpiresAt = now + StateLifetime,
            });
            await db.SaveChangesAsync();
        }
        var q = new Dictionary<string, string>
        {
            ["client_id"] = options.ClientId!,
            ["redirect_uri"] = options.RedirectUri!,
            ["response_type"] = "code",
            ["scope"] = string.Join(' ', GoogleMailOptions.Scopes),
            // a refresh token is needed for sending later without the admin
            ["access_type"] = "offline",
            ["prompt"] = "consent",
            ["include_granted_scopes"] = "false",
            ["login_hint"] = options.SenderEmail,
            ["state"] = state,
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = "S256",
        };
        var url = AuthEndpoint + "?" + string.Join("&", q.Select(kv => $"{kv.Key}={Uri.EscapeDataString(kv.Value)}"));
        logger.LogInformation("Gmail connection started by {Admin}", admin);
        return (url, binding);
    }

    /// <summary>
    /// Google's return. The state must be known, unused, unexpired and bound to this browser; then the code is exchanged
    /// (with the PKCE verifier) and the account checked. Returns a short result code — never a token.
    /// </summary>
    public async Task<string> CompleteAsync(string? state, string? code, string? error, string? binding)
    {
        if (!options.Configured) return "not-configured";
        if (string.IsNullOrEmpty(state) || state.Length > 200) return "bad-state";
        var now = DateTime.UtcNow;
        var stateHash = Hash(state);
        OAuthState row;
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
            // single use: the state is claimed atomically, so a replayed callback finds it already used
            var claimed = await db.OAuthStates.Where(s => s.StateHash == stateHash && s.UsedAt == null && s.ExpiresAt > now)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.UsedAt, now));
            var found = await db.OAuthStates.AsNoTracking().FirstOrDefaultAsync(s => s.StateHash == stateHash);
            if (found == null) return "bad-state";
            if (claimed == 0) return found.ExpiresAt <= now ? "expired-state" : "used-state";
            row = found;
        }
        // the callback must come back to the browser that started it (login CSRF / code injection)
        if (string.IsNullOrEmpty(binding) || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(binding)), Encoding.ASCII.GetBytes(row.BindingHash)))
            return "bad-state";
        if (!string.IsNullOrEmpty(error)) return error == "access_denied" ? "denied" : "google-error";
        if (string.IsNullOrEmpty(code) || code.Length > 2048) return "bad-state";

        JsonElement tokens;
        try
        {
            using var client = Client();
            var res = await client.PostAsync(TokenEndpoint, new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["code"] = code, ["client_id"] = options.ClientId!, ["client_secret"] = options.ClientSecret!,
                ["redirect_uri"] = options.RedirectUri!, ["grant_type"] = "authorization_code", ["code_verifier"] = row.CodeVerifier,
            }));
            var body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                logger.LogWarning("Gmail connection: code exchange refused ({Status}, {Error})", (int)res.StatusCode, OAuthErrorCode(body));
                return "exchange-failed";
            }
            tokens = JsonDocument.Parse(body).RootElement.Clone();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning("Gmail connection: code exchange failed ({Type})", ex.GetType().Name);
            return "exchange-failed";
        }

        var refresh = tokens.TryGetProperty("refresh_token", out var rt) ? rt.GetString() : null;
        var access = tokens.TryGetProperty("access_token", out var at) ? at.GetString() : null;
        var scopesGranted = tokens.TryGetProperty("scope", out var sc) ? sc.GetString() ?? "" : "";
        var (email, verified) = IdTokenEmail(tokens.TryGetProperty("id_token", out var idt) ? idt.GetString() : null);
        if (email == null || !verified || !string.Equals(email, options.SenderEmail, StringComparison.OrdinalIgnoreCase))
        {
            // another mailbox was chosen: its grant is revoked at once and nothing is stored
            await RevokeAsync(refresh ?? access);
            logger.LogWarning("Gmail connection refused: a different account was authorized");
            return "wrong-account";
        }
        if (!scopesGranted.Split(' ').Contains(GoogleMailOptions.SendScope)) return "missing-scope";
        if (string.IsNullOrEmpty(refresh)) return "no-refresh-token";

        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
            var acc = await db.MailAccounts.FirstOrDefaultAsync(a => a.Id == "gmail");
            if (acc == null) db.MailAccounts.Add(acc = new MailAccount { Id = "gmail" });
            acc.Email = options.SenderEmail;
            acc.Status = MailAccountStatus.Connected;
            acc.EncryptedRefreshToken = protector.Seal(refresh, options.SenderEmail);
            acc.KeyFingerprint = protector.Fingerprint;
            acc.Scopes = scopesGranted;
            acc.ConnectedAt = DateTime.UtcNow;
            acc.ConnectedBy = row.AdminName;
            acc.LastError = null;
            acc.LastErrorAt = null;
            acc.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        await _tokenGate.WaitAsync();
        try
        {
            _accessToken = access;
            _accessTokenExpires = DateTime.UtcNow.AddSeconds(tokens.TryGetProperty("expires_in", out var ei) ? ei.GetInt32() : 3000);
        }
        finally { _tokenGate.Release(); }
        _availability = null;
        logger.LogInformation("Gmail account connected by {Admin}", row.AdminName);
        return "connected";
    }

    /// <summary>The address in the id_token returned directly by Google's token endpoint over TLS (no third party in between).</summary>
    private static (string? Email, bool Verified) IdTokenEmail(string? idToken)
    {
        try
        {
            var parts = idToken?.Split('.');
            if (parts is not { Length: 3 }) return (null, false);
            var payload = parts[1].Replace('-', '+').Replace('_', '/');
            payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
            using var doc = JsonDocument.Parse(Convert.FromBase64String(payload));
            var r = doc.RootElement;
            var email = r.TryGetProperty("email", out var e) ? e.GetString() : null;
            var verified = r.TryGetProperty("email_verified", out var v) && (v.ValueKind == JsonValueKind.True || (v.ValueKind == JsonValueKind.String && v.GetString() == "true"));
            return (email?.ToLowerInvariant(), verified);
        }
        catch (Exception ex) when (ex is FormatException or JsonException)
        {
            return (null, false);
        }
    }

    private static string OAuthErrorCode(string body)
    {
        try { return JsonDocument.Parse(body).RootElement.TryGetProperty("error", out var e) ? e.GetString() ?? "error" : "error"; }
        catch (JsonException) { return "error"; }
    }

    private async Task RevokeAsync(string? token)
    {
        if (string.IsNullOrEmpty(token)) return;
        try
        {
            using var client = Client();
            await client.PostAsync(RevokeEndpoint, new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = token }));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { /* best effort */ }
    }

    // ------------------------------------------------------------------ status

    public async Task<MailAccountView> ViewAsync()
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var acc = await db.MailAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == "gmail");
        var status = acc?.Status ?? MailAccountStatus.NotConnected;
        var keyChanged = acc is { Status: MailAccountStatus.Connected } && options.Configured && acc.KeyFingerprint != protector.Fingerprint;
        var connected = options.Configured && status == MailAccountStatus.Connected && !keyChanged;
        return new MailAccountView(
            options.Configured, options.Missing(), options.RedirectUri, options.SenderEmail,
            keyChanged ? "needs-reconnect" : status switch { MailAccountStatus.Connected => "connected", MailAccountStatus.NeedsReconnect => "needs-reconnect", _ => "not-connected" },
            connected, keyChanged || status == MailAccountStatus.NeedsReconnect, keyChanged ? "key-changed" : acc?.LastError, acc?.LastErrorAt,
            acc?.ConnectedAt, acc?.LastSendAt, acc?.LastTestSentAt, acc?.Scopes.Split(' ').Contains(GoogleMailOptions.SendScope) ?? false);
    }

    /// <summary>Sending is offered only while the mailbox is connected (checked at most every 30 seconds).</summary>
    public async Task<bool> IsAvailableAsync()
    {
        if (!options.Configured) return false;
        if (_availability is { } a && DateTime.UtcNow - a.At < TimeSpan.FromSeconds(30)) return a.Available;
        var available = (await ViewAsync()).Connected;
        _availability = (available, DateTime.UtcNow);
        return available;
    }

    private async Task MarkAsync(Action<MailAccount> change)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var acc = await db.MailAccounts.FirstOrDefaultAsync(a => a.Id == "gmail");
        if (acc == null) return;
        change(acc);
        acc.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    /// <summary>The grant is gone (revoked, expired or the key changed): sending stops and the admin sees "reconnect".</summary>
    private async Task NeedsReconnectAsync(string reason)
    {
        _accessToken = null;
        _availability = (false, DateTime.UtcNow);
        await MarkAsync(a => { a.Status = MailAccountStatus.NeedsReconnect; a.LastError = reason; a.LastErrorAt = DateTime.UtcNow; });
        logger.LogWarning("Gmail account needs reconnecting ({Reason})", reason);
    }

    // ------------------------------------------------------------------ tokens

    /// <summary>A valid access token: the cached one, or a new one from the stored refresh token.</summary>
    public async Task<string> AccessTokenAsync(bool forceRefresh = false, CancellationToken ct = default)
    {
        await _tokenGate.WaitAsync(ct);
        try
        {
            if (!forceRefresh && _accessToken != null && _accessTokenExpires > DateTime.UtcNow.AddMinutes(1)) return _accessToken;
            MailAccount? acc;
            using (var scope = scopes.CreateScope())
                acc = await scope.ServiceProvider.GetRequiredService<PortalDbContext>().MailAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == "gmail", ct);
            if (acc is not { Status: MailAccountStatus.Connected } || acc.EncryptedRefreshToken == null)
                throw new EmailSendException("needs-reconnect", false);
            if (acc.KeyFingerprint != protector.Fingerprint)
            {
                await NeedsReconnectAsync("key-changed");
                throw new EmailSendException("needs-reconnect", false);
            }
            var refresh = protector.Open(acc.EncryptedRefreshToken, acc.Email);
            if (refresh == null)
            {
                await NeedsReconnectAsync("token-unreadable");
                throw new EmailSendException("needs-reconnect", false);
            }

            HttpResponseMessage res;
            string body;
            try
            {
                using var client = Client();
                res = await client.PostAsync(TokenEndpoint, new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["client_id"] = options.ClientId!, ["client_secret"] = options.ClientSecret!,
                    ["refresh_token"] = refresh, ["grant_type"] = "refresh_token",
                }), ct);
                body = await res.Content.ReadAsStringAsync(ct);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                logger.LogWarning("Gmail token refresh failed ({Type})", ex.GetType().Name);
                throw new EmailSendException("google-unreachable", true, ex);
            }
            if (!res.IsSuccessStatusCode)
            {
                var err = OAuthErrorCode(body);
                if (err is "invalid_grant" or "unauthorized_client" or "invalid_client")
                {
                    // revoked, expired (e.g. a 7-day "Testing" grant) or the client changed: only reconnecting helps
                    await NeedsReconnectAsync(err);
                    throw new EmailSendException("needs-reconnect", false);
                }
                logger.LogWarning("Gmail token refresh refused ({Status}, {Error})", (int)res.StatusCode, err);
                throw new EmailSendException("google-error", (int)res.StatusCode >= 500);
            }
            var json = JsonDocument.Parse(body).RootElement;
            _accessToken = json.GetProperty("access_token").GetString();
            _accessTokenExpires = DateTime.UtcNow.AddSeconds(json.TryGetProperty("expires_in", out var ei) ? ei.GetInt32() : 3000);
            return _accessToken!;
        }
        finally
        {
            _tokenGate.Release();
        }
    }

    // ------------------------------------------------------------------ sending

    /// <summary>
    /// Sends through Gmail API. A 401 renews the access token once and tries once more; quota, rate and server errors are
    /// reported as temporary; a broken connection after the request went out is "uncertain" (never retried automatically).
    /// </summary>
    public async Task<string> SendAsync(EmailMessage m, CancellationToken ct = default)
    {
        if (!options.Configured) throw new EmailSendException("not-configured", false);
        var raw = Mime.Build(m, options.SenderName, options.SenderEmail);
        var token = await AccessTokenAsync(false, ct);
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                var id = await SendRawAsync(token, raw, ct);
                await MarkAsync(a => { a.LastSendAt = DateTime.UtcNow; a.LastError = null; });
                return id;
            }
            catch (GoogleApiException ex) when (ex.HttpStatusCode == HttpStatusCode.Unauthorized && attempt == 0)
            {
                token = await AccessTokenAsync(true, ct);
            }
            catch (GoogleApiException ex)
            {
                var reason = ex.Error?.Errors?.FirstOrDefault()?.Reason ?? "";
                var status = (int)ex.HttpStatusCode;
                logger.LogWarning("Gmail send failed ({Status}, {Reason})", status, reason);
                if (status == 401 || (status == 403 && reason is "insufficientPermissions" or "forbidden" or "authError"))
                {
                    await NeedsReconnectAsync(status == 401 ? "unauthorized" : "insufficient-scope");
                    throw new EmailSendException("needs-reconnect", false, ex);
                }
                if (status == 429 || (status == 403 && reason.Contains("Limit", StringComparison.OrdinalIgnoreCase)) || reason.Contains("quota", StringComparison.OrdinalIgnoreCase))
                    throw new EmailSendException("quota", true, ex);
                if (status >= 500) throw new EmailSendException("google-error", true, ex);
                throw new EmailSendException("rejected", false, ex);
            }
            catch (HttpRequestException ex) when (ex.InnerException is System.Net.Sockets.SocketException)
            {
                // no connection at all: nothing reached Google
                logger.LogWarning("Gmail send: no connection");
                throw new EmailSendException("google-unreachable", true, ex);
            }
            catch (Exception ex) when (ex is TaskCanceledException or HttpRequestException or IOException && !ct.IsCancellationRequested)
            {
                // the request may have reached Google before the connection broke: do not resend on our own
                logger.LogWarning("Gmail send: outcome unknown ({Type})", ex.GetType().Name);
                throw new EmailSendException("uncertain", false, ex, uncertain: true);
            }
        }
    }

    private async Task<string> SendRawAsync(string accessToken, string raw, CancellationToken ct)
    {
        using var service = new GmailService(new BaseClientService.Initializer
        {
            HttpClientInitializer = GoogleCredential.FromAccessToken(accessToken),
            HttpClientFactory = new GoogleLibHttpFactory(http),
            ApplicationName = "PORTAL X",
            // retries are decided here, not by the library
            DefaultExponentialBackOffPolicy = Google.Apis.Http.ExponentialBackOffPolicy.None,
        });
        service.HttpClient.Timeout = RequestTimeout;
        var sent = await service.Users.Messages.Send(new Message { Raw = raw }, "me").ExecuteAsync(ct);
        if (string.IsNullOrEmpty(sent?.Id)) throw new EmailSendException("uncertain", false, uncertain: true);
        return sent.Id;
    }

    public async Task MarkTestSentAsync() => await MarkAsync(a => a.LastTestSentAt = DateTime.UtcNow);
}

/// <summary>Gmail API as the site's <see cref="IEmailSender"/>.</summary>
public sealed class GmailEmailSender(GmailAccount account) : IEmailSender
{
    public Task<bool> IsAvailableAsync(CancellationToken ct = default) => account.IsAvailableAsync();
    public Task<string> SendAsync(EmailMessage message, CancellationToken ct = default) => account.SendAsync(message, ct);
}

/// <summary>
/// A MIME message (multipart/alternative: plain text + HTML, UTF-8, base64 parts) in the base64url "raw" form Gmail API
/// takes. Header values are encoded, and the recipient was validated, so no header can be injected.
/// </summary>
public static class Mime
{
    private static string Word(string s) => "=?UTF-8?B?" + Convert.ToBase64String(Encoding.UTF8.GetBytes(s)) + "?=";

    private static string Body(string s)
    {
        var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(s));
        var sb = new StringBuilder();
        for (var i = 0; i < b64.Length; i += 76) sb.Append(b64, i, Math.Min(76, b64.Length - i)).Append("\r\n");
        return sb.ToString();
    }

    public static string Text(EmailMessage m, string fromName, string fromEmail)
    {
        if (m.To.IndexOfAny(['\r', '\n', '<', '>', ',', ';']) >= 0) throw new EmailSendException("bad-recipient", false);
        var boundary = "px_" + Guid.NewGuid().ToString("N");
        var h = new StringBuilder();
        h.Append($"From: {Word(fromName)} <{fromEmail}>\r\n");
        h.Append($"To: <{m.To}>\r\n");
        h.Append($"Reply-To: {Word(fromName)} <{fromEmail}>\r\n");
        h.Append($"Subject: {Word(m.Subject)}\r\n");
        h.Append($"Date: {DateTime.UtcNow:r}\r\n");
        h.Append($"Message-ID: <{Guid.NewGuid():N}@portalx>\r\n");
        if (m.UnsubscribeUrl != null) h.Append($"List-Unsubscribe: <{m.UnsubscribeUrl}>\r\n");
        h.Append("MIME-Version: 1.0\r\n");
        h.Append($"Content-Type: multipart/alternative; boundary=\"{boundary}\"\r\n\r\n");
        h.Append($"--{boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{Body(m.Text)}");
        h.Append($"--{boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{Body(m.Html)}");
        h.Append($"--{boundary}--\r\n");
        return h.ToString();
    }

    public static string Build(EmailMessage m, string fromName, string fromEmail) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(Text(m, fromName, fromEmail))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
