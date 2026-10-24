using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Mail;

namespace PortalX.Tests;

/// <summary>Records sent mail instead of sending it; can be told to fail.</summary>
public sealed class FakeEmailSender : IEmailSender
{
    public List<EmailMessage> Sent { get; } = new();
    public int FailNext { get; set; }
    public bool Transient { get; set; } = true;
    public int Calls { get; private set; }
    public bool Available => true;

    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        Calls++;
        await Task.Delay(30, ct);
        if (FailNext > 0)
        {
            FailNext--;
            throw new EmailSendException("smtp-error", Transient);
        }
        lock (Sent) Sent.Add(message);
    }
}

/// <summary>Results email, marketing consent and group link (results email spec, section 10).</summary>
[Collection(DatabaseCollection.Name)]
public class ResultsEmailTests
{
    private const string GroupUrl = "https://chat.whatsapp.com/TestInviteLink";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HubIntegrationTests.Factory _factory;

    public ResultsEmailTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private (WebApplicationFactory<Program> F, FakeEmailSender Mail) WithMail()
    {
        var mail = new FakeEmailSender();
        var f = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PORTALX_COMMUNITY_GROUP_URL"] = GroupUrl,
                ["PORTALX_SITE_URL"] = "https://portalx.test",
                ["RateLimits:ResultsEmailPer10Minutes"] = "100000",
                ["RateLimits:UnsubscribePerMinute"] = "100000",
            }));
            b.ConfigureTestServices(s => s.AddSingleton<IEmailSender>(mail));
        });
        return (f, mail);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>(Json);

    private static string Unique(string name) => $"{name}.{Guid.NewGuid():N}"[..20] + "@Example.org";

    private sealed record Seat(Guid Id, string Token, string Nickname);

    /// <summary>
    /// A real game opened and joined through the API, then finished: the score board gets known points and the
    /// result is built by the game engine itself — the email must show exactly these numbers.
    /// </summary>
    private static async Task<(string Code, List<Seat> Seats)> FinishedGameAsync(WebApplicationFactory<Program> f, string scenario)
    {
        var http = f.CreateClient();
        string code, claim;
        if (scenario == "gate-of-secrets")
        {
            var g = await Body(await http.PostAsync("/api/products/gate-of-secrets/free-game", null));
            (code, claim) = (g.GetProperty("code").GetString()!, g.GetProperty("hostClaim").GetString()!);
        }
        // the original game is bought through the test product the purchase tests use (same scenario)
        else (code, claim) = scenario == "last-portal"
            ? await TestPurchase.PaidRoomAsync(http, f.Services)
            : await TestPurchase.PaidRoomAsync(http, f.Services, scenario);

        var seats = new List<Seat>();
        foreach (var (nick, ch, i) in new[] { ("Avi", "explorer", 0), ("Dudi", "scholar", 1) })
        {
            var j = await Body(await f.CreateClient().PostAsJsonAsync($"/api/rooms/{code}/players",
                new { nickname = nick, characterId = ch, appearance = "{}", hostClaim = i == 0 ? claim : null }));
            seats.Add(new Seat(j.GetProperty("playerId").GetGuid(), j.GetProperty("token").GetString()!, nick));
        }

        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var engine = scope.ServiceProvider.GetRequiredService<GameEngine>();
        var room = await db.Rooms.Include(r => r.Players).Include(r => r.Puzzles).FirstAsync(r => r.Code == code);
        var now = DateTime.UtcNow;
        foreach (var p in room.Puzzles) { p.Status = PuzzleStatus.Solved; p.SolvedAt = now; }
        var world = GameEngine.World(room);
        if (engine.Catalog.Get(room.ScenarioId).Scoring != null)
        {
            world.Score = new ScoreBoard { Group = 340 };
            world.Score.Personal[seats[0].Id.ToString()] = 125;
            world.Score.Personal[seats[1].Id.ToString()] = 90;
        }
        room.Phase = RoomPhase.Completed;
        room.StartedAt = now.AddMinutes(-21).AddSeconds(-5);
        room.EndedAt = now;
        GameEngine.SaveWorld(room, world, now);
        db.Results.Add(engine.BuildResult(room));
        await db.SaveChangesAsync();
        return (code, seats);
    }

    private static Task<HttpResponseMessage> Ask(WebApplicationFactory<Program> f, string code, string? token, bool results, string? email,
        bool marketing = false, bool group = false) =>
        f.CreateClient().PostAsJsonAsync($"/api/rooms/{code}/results-email",
            new { token, sendResults = results, email, marketingConsent = marketing, communityLink = group });

    private static async Task<T> Db<T>(WebApplicationFactory<Program> f, Func<PortalDbContext, Task<T>> q)
    {
        using var scope = f.Services.CreateScope();
        return await q(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    // 1, 4, 10, 12 — every game: the real scores go out, and a results request is not a subscription
    [Theory]
    [InlineData("last-portal")]
    [InlineData("hanukkah-oil")]
    [InlineData("gate-of-secrets")]
    public async Task A_valid_request_sends_the_real_results_once_and_subscribes_nobody(string scenario)
    {
        var (f, mail) = WithMail();
        using var _ = f;
        var (code, seats) = await FinishedGameAsync(f, scenario);
        var address = Unique("res");

        var r = await Body(await Ask(f, code, seats[0].Token, true, address));
        Assert.True(r.GetProperty("ok").GetBoolean(), r.ToString());
        Assert.Equal("sent", r.GetProperty("resultsStatus").GetString());
        Assert.Equal(ResultsEmailService.SentMessage, r.GetProperty("message").GetString());

        var m = Assert.Single(mail.Sent);
        Assert.Equal(address.ToLowerInvariant(), m.To);
        Assert.Contains("dir=\"rtl\"", m.Html);
        Assert.Contains("כל הכבוד! השלמתם את ההרפתקה", m.Html);
        Assert.Contains(SiteOptions.DefaultContactEmail, m.Html);
        Assert.DoesNotContain("<img", m.Html);
        Assert.Contains("21:05", m.Html);
        var result = await Db(f, db => db.Results.AsNoTracking().FirstAsync(x => db.Rooms.Any(rm => rm.Code == code && rm.Id == x.RoomId)));
        Assert.Contains($"{result.PuzzlesSolved} מתוך {result.PuzzlesTotal}", m.Html);
        if (scenario == "last-portal")
        {
            // the original game keeps no points: none are shown or made up
            Assert.DoesNotContain("הניקוד האישי", m.Html);
            Assert.DoesNotContain("הניקוד הקבוצתי", m.Html);
        }
        else
        {
            Assert.Contains(">125<", m.Html);
            Assert.Contains(">340<", m.Html);
            Assert.Contains("Dudi", m.Html);
            Assert.Contains(">90<", m.Html);
        }
        Assert.Null(m.UnsubscribeUrl);
        Assert.False(await Db(f, db => db.MarketingConsents.AnyAsync(c => c.Email == address.ToLowerInvariant())));
        var req = await Db(f, db => db.ResultEmailRequests.AsNoTracking().FirstAsync(x => x.Email == address.ToLowerInvariant()));
        Assert.Equal(ResultEmailStatus.Sent, req.Status);
        Assert.Equal(result.Id, req.GameResultId);
        Assert.NotNull(req.SentAt);
    }

    // 2, 3 — nothing chosen or a bad address: no mail, a clear message
    [Fact]
    public async Task No_request_or_a_bad_address_sends_nothing()
    {
        var (f, mail) = WithMail();
        using var _ = f;
        var (code, seats) = await FinishedGameAsync(f, "gate-of-secrets");
        var none = await Ask(f, code, seats[0].Token, false, null);
        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);
        foreach (var bad in new[] { "not-an-email", "a@b", "x y@z.com", "<a@b.com>", "" })
        {
            var r = await Ask(f, code, seats[0].Token, true, bad);
            Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
            Assert.Equal(ResultsEmailService.BadEmailMessage, (await Body(r)).GetProperty("message").GetString());
        }
        Assert.Empty(mail.Sent);
        Assert.Equal(0, await Db(f, db => db.ResultEmailRequests.CountAsync(x => db.Rooms.Any(r => r.Code == code && r.Id == x.RoomId))));
    }

    // 5, 6 — explicit consent is recorded with date and source; unsubscribing stops marketing mail; only a new tick restores it
    [Fact]
    public async Task Consent_is_explicit_and_unsubscribing_works_without_an_account()
    {
        var (f, mail) = WithMail();
        using var _ = f;
        var (code, seats) = await FinishedGameAsync(f, "hanukkah-oil");
        var address = Unique("mkt");
        var r = await Body(await Ask(f, code, seats[0].Token, true, address, marketing: true));
        Assert.True(r.GetProperty("consentRecorded").GetBoolean());
        var consent = await Db(f, db => db.MarketingConsents.AsNoTracking().FirstAsync(c => c.Email == address.ToLowerInvariant()));
        Assert.Equal(ConsentStatus.Active, consent.Status);
        Assert.Equal("hanukkah-oil", consent.Source);
        Assert.Equal(ResultsEmailService.ConsentVersion, consent.ConsentVersion);
        Assert.Equal(ResultsEmailService.ConsentText, consent.ConsentText);
        Assert.True((DateTime.UtcNow - consent.ConsentedAt).TotalMinutes < 2);

        // the email to a subscriber carries a personal, signed unsubscribe link
        var unsub = Assert.Single(mail.Sent).UnsubscribeUrl!;
        Assert.Contains("להסרה מרשימת הדיוור", mail.Sent[0].Html);
        var token = unsub.Split("#t=")[1];

        // a forged link (another id, or a changed signature) does nothing
        var forged = Guid.NewGuid().ToString("N") + "." + token.Split('.')[1];
        Assert.Equal(HttpStatusCode.BadRequest, (await f.CreateClient().PostAsJsonAsync("/api/unsubscribe", new { token = forged })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await f.CreateClient().PostAsJsonAsync("/api/unsubscribe", new { token = token[..^2] + "xx" })).StatusCode);

        var ok = await f.CreateClient().PostAsJsonAsync("/api/unsubscribe", new { token });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        consent = await Db(f, db => db.MarketingConsents.AsNoTracking().FirstAsync(c => c.Email == address.ToLowerInvariant()));
        Assert.Equal(ConsentStatus.Revoked, consent.Status);
        Assert.NotNull(consent.RevokedAt);
        // the results history stays
        Assert.True(await Db(f, db => db.ResultEmailRequests.AnyAsync(x => x.Email == address.ToLowerInvariant())));

        // later results email without a new tick: no marketing link, still revoked
        var (code2, seats2) = await FinishedGameAsync(f, "gate-of-secrets");
        await Ask(f, code2, seats2[0].Token, true, address);
        Assert.Null(mail.Sent.Last().UnsubscribeUrl);
        Assert.Equal(ConsentStatus.Revoked, (await Db(f, db => db.MarketingConsents.AsNoTracking().FirstAsync(c => c.Email == address.ToLowerInvariant()))).Status);

        // a new, explicit tick makes it active again — and retires the old link
        await Ask(f, code2, seats2[1].Token, false, address, marketing: true);
        Assert.Equal(ConsentStatus.Active, (await Db(f, db => db.MarketingConsents.AsNoTracking().FirstAsync(c => c.Email == address.ToLowerInvariant()))).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await f.CreateClient().PostAsJsonAsync("/api/unsubscribe", new { token })).StatusCode);
    }

    // 7 — the group link only: stored as a request, never as membership, no mail and no consent
    [Fact]
    public async Task Asking_for_the_group_link_records_a_request_only()
    {
        var (f, mail) = WithMail();
        using var _ = f;
        var (code, seats) = await FinishedGameAsync(f, "last-portal");
        var r = await Body(await Ask(f, code, seats[1].Token, false, null, group: true));
        Assert.True(r.GetProperty("ok").GetBoolean());
        Assert.Equal(GroupUrl, r.GetProperty("communityGroupUrl").GetString());
        Assert.False(r.GetProperty("consentRecorded").GetBoolean());
        Assert.Empty(mail.Sent);
        var req = await Db(f, db => db.CommunityLinkRequests.AsNoTracking().SingleAsync(x => x.PlayerId == seats[1].Id));
        Assert.Equal("last-portal", req.Source);
        Assert.Null(req.Email);
        Assert.DoesNotContain(typeof(CommunityLinkRequest).GetProperties(), p => p.Name.Contains("Joined") || p.Name.Contains("Member"));
        // asking again does not add a second request
        await Ask(f, code, seats[1].Token, false, null, group: true);
        Assert.Equal(1, await Db(f, db => db.CommunityLinkRequests.CountAsync(x => x.PlayerId == seats[1].Id)));
    }

    // 8 — refresh, a second click, two tabs at once: one email
    [Fact]
    public async Task Repeated_or_simultaneous_requests_send_one_email()
    {
        var (f, mail) = WithMail();
        using var _ = f;
        var (code, seats) = await FinishedGameAsync(f, "gate-of-secrets");
        var address = Unique("dup");
        var parallel = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => Ask(f, code, seats[0].Token, true, address)));
        Assert.All(parallel, p => Assert.Equal(HttpStatusCode.OK, p.StatusCode));
        var again = await Body(await Ask(f, code, seats[0].Token, true, address));
        Assert.Equal("already-sent", again.GetProperty("code").GetString());
        Assert.Single(mail.Sent);
        Assert.Equal(1, await Db(f, db => db.ResultEmailRequests.CountAsync(x => x.PlayerId == seats[0].Id)));
    }

    // 9 — the mail server fails: recorded as failed, the player may retry, and success sends exactly once
    [Fact]
    public async Task A_mail_failure_is_recorded_and_a_retry_sends_once()
    {
        var (f, mail) = WithMail();
        using var _ = f;
        var (code, seats) = await FinishedGameAsync(f, "hanukkah-oil");
        var address = Unique("fail");
        mail.FailNext = 2; // both quick attempts fail
        var r = await Body(await Ask(f, code, seats[0].Token, true, address));
        Assert.False(r.GetProperty("ok").GetBoolean());
        Assert.Equal("send-failed", r.GetProperty("code").GetString());
        Assert.Equal(ResultsEmailService.FailedMessage, r.GetProperty("message").GetString());
        var req = await Db(f, db => db.ResultEmailRequests.AsNoTracking().FirstAsync(x => x.PlayerId == seats[0].Id));
        Assert.Equal(ResultEmailStatus.Failed, req.Status);
        Assert.Equal(2, req.Attempts);
        Assert.Equal("smtp-error", req.LastError);
        Assert.Empty(mail.Sent);

        var retry = await Body(await Ask(f, code, seats[0].Token, true, address));
        Assert.True(retry.GetProperty("ok").GetBoolean());
        Assert.Single(mail.Sent);
        Assert.Equal(ResultEmailStatus.Sent, (await Db(f, db => db.ResultEmailRequests.AsNoTracking().FirstAsync(x => x.PlayerId == seats[0].Id))).Status);

        // a refused address is not retried in a loop
        var (code2, seats2) = await FinishedGameAsync(f, "gate-of-secrets");
        mail.FailNext = 1;
        mail.Transient = false;
        var calls = mail.Calls;
        await Ask(f, code2, seats2[0].Token, true, Unique("perm"));
        Assert.Equal(calls + 1, mail.Calls);
    }

    // 13 — only a participant can ask, only after the end, and nobody else's address appears anywhere
    [Fact]
    public async Task Only_participants_of_a_finished_game_may_ask_and_other_players_stay_private()
    {
        var (f, mail) = WithMail();
        using var _ = f;
        var (code, seats) = await FinishedGameAsync(f, "hanukkah-oil");
        Assert.Equal(HttpStatusCode.Forbidden, (await Ask(f, code, "not-a-seat-token", true, Unique("x"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Ask(f, code, null, true, Unique("x"))).StatusCode);

        var avi = Unique("avi");
        var dudi = Unique("dudi");
        await Ask(f, code, seats[0].Token, true, avi);
        await Ask(f, code, seats[1].Token, true, dudi);
        Assert.Equal(2, mail.Sent.Count);
        Assert.DoesNotContain(dudi.ToLowerInvariant(), mail.Sent[0].Html + mail.Sent[0].Text);
        Assert.DoesNotContain(avi.ToLowerInvariant(), mail.Sent[1].Html + mail.Sent[1].Text);
        // each email marks its own recipient
        Assert.Contains("Avi (את/ה)", mail.Sent[0].Text);
        Assert.Contains("Dudi (את/ה)", mail.Sent[1].Text);

        // a game still being played: results are not available yet
        var g = await Body(await f.CreateClient().PostAsync("/api/products/gate-of-secrets/free-game", null));
        var playing = g.GetProperty("code").GetString()!;
        var j = await Body(await f.CreateClient().PostAsJsonAsync($"/api/rooms/{playing}/players",
            new { nickname = "Host", characterId = "explorer", appearance = "{}", hostClaim = g.GetProperty("hostClaim").GetString() }));
        Assert.Equal(HttpStatusCode.Conflict, (await Ask(f, playing, j.GetProperty("token").GetString(), true, Unique("x"))).StatusCode);
    }

    [Fact]
    public async Task Without_mail_settings_the_site_says_so_and_sends_nothing()
    {
        var http = _factory.CreateClient();
        var site = await Body(await http.GetAsync("/api/site"));
        Assert.Equal("info.portalx@gmail.com", site.GetProperty("contactEmail").GetString());
        Assert.False(site.GetProperty("resultsEmail").GetBoolean());
        Assert.False(site.GetProperty("communityGroup").GetBoolean());
        var (code, seats) = await FinishedGameAsync(_factory, "gate-of-secrets");
        var r = await http.PostAsJsonAsync($"/api/rooms/{code}/results-email",
            new { token = seats[0].Token, sendResults = true, email = Unique("n"), marketingConsent = false, communityLink = false });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode);
    }

    // 11 — the list and its export are for the admin only, with each consent kind apart
    [Fact]
    public async Task The_mailing_list_is_admin_only_and_keeps_each_status_apart()
    {
        var (f, mail) = WithMail();
        using var _ = f;
        foreach (var url in new[] { "/api/admin/mailing", "/api/admin/mailing.csv" })
        {
            var anon = await f.CreateClient().GetAsync(url);
            Assert.True(anon.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden, url);
        }

        var (code, seats) = await FinishedGameAsync(f, "hanukkah-oil");
        var resultsOnly = Unique("only");
        var subscriber = Unique("sub");
        await Ask(f, code, seats[0].Token, true, resultsOnly);
        await Ask(f, code, seats[1].Token, true, subscriber, marketing: true, group: true);

        var admin = f.CreateClient();
        (await admin.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        admin.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        var list = await Body(await admin.GetAsync("/api/admin/mailing?search=" + Uri.EscapeDataString(resultsOnly.ToLowerInvariant())));
        var row = Assert.Single(list.GetProperty("rows").EnumerateArray());
        Assert.Equal("none", row.GetProperty("consent").GetString());
        Assert.Equal("sent", row.GetProperty("resultsStatus").GetString());
        Assert.False(row.GetProperty("groupLinkRequested").GetBoolean());

        var subs = await Body(await admin.GetAsync("/api/admin/mailing?consent=active"));
        var emails = subs.GetProperty("rows").EnumerateArray().Select(x => x.GetProperty("email").GetString()).ToList();
        Assert.Contains(subscriber.ToLowerInvariant(), emails);
        Assert.DoesNotContain(resultsOnly.ToLowerInvariant(), emails);
        Assert.True(subs.GetProperty("totals").GetProperty("activeSubscribers").GetInt32() >= 1);
        Assert.True(subs.GetProperty("totals").GetProperty("groupLinkRequests").GetInt32() >= 1);

        var csv = await admin.GetAsync("/api/admin/mailing.csv?consent=active");
        Assert.Equal(HttpStatusCode.OK, csv.StatusCode);
        var text = await csv.Content.ReadAsStringAsync();
        Assert.Contains("הסכמה שיווקית", text);
        Assert.Contains(subscriber.ToLowerInvariant(), text);
        Assert.DoesNotContain(resultsOnly.ToLowerInvariant(), text);
        Assert.Contains("/unsubscribe#t=", text);
    }

    // 15 — the template stays readable: encoded player names, a text twin, mobile rules, no images
    [Fact]
    public void The_template_encodes_names_and_has_a_plain_text_twin()
    {
        var model = new ResultsEmailModel("סוד פך השמן", new DateTime(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc), "<b>X</b>",
            125, 1, false, [new TeamScore("<script>", 125, 1, true), new TeamScore("Dudi", 90, 2, false)], 340,
            1265, 11, 11, 2, [new EarnedAchievement("בלי רמזים", "סיימתם בלי רמזים")], "https://portalx.test", "info.portalx@gmail.com", null);
        var html = ResultsEmailTemplate.Html(model);
        Assert.DoesNotContain("<script>", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.Contains("max-width: 620px", html);
        Assert.Contains("20:00", html);
        Assert.Contains("21:05", html);
        Assert.DoesNotContain("<img", html);
        var text = ResultsEmailTemplate.Text(model);
        Assert.Contains("הניקוד האישי שלך: 125", text);
        Assert.Contains("הניקוד הקבוצתי: 340", text);
        Assert.Contains("11 מתוך 11", text);
    }

    [Fact]
    public void Addresses_are_checked_and_normalized_on_the_server()
    {
        Assert.Equal("name@example.org", ResultsEmailService.NormalizeEmail("  Name@Example.org "));
        Assert.Null(ResultsEmailService.NormalizeEmail("name@example"));
        Assert.Null(ResultsEmailService.NormalizeEmail("na me@example.org"));
        Assert.Null(ResultsEmailService.NormalizeEmail(new string('a', 250) + "@x.org"));
        Assert.Null(ResultsEmailService.NormalizeEmail("a@b.c"));
    }
}
