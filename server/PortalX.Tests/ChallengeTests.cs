using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Challenge;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Mail;
using PortalX.Server.Payments;

namespace PortalX.Tests;

/// <summary>"Challenge 240": the rules on their own (no database).</summary>
public class ChallengeRulesTests
{
    private static DateTime Il(int month, int day, int hour, int minute) =>
        TimeZoneInfo.ConvertTimeToUtc(new DateTime(2026, month, day, hour, minute, 0), TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Israel Standard Time" : "Asia/Jerusalem"));

    [Fact]
    public void The_minimum_is_inclusive_240_does_not_qualify_and_241_does()
    {
        Assert.False(ChallengeRules.Qualifies(240, 241));
        Assert.True(ChallengeRules.Qualifies(241, 241));
        Assert.True(ChallengeRules.Qualifies(355, 241));
        Assert.False(ChallengeRules.Qualifies(0, 241));
    }

    [Theory]
    [InlineData(3, 1, 10, 0, "09.03.2026 בשעה 10:00")]
    [InlineData(3, 5, 18, 30, "13.03.2026 בשעה 18:30")]
    [InlineData(3, 20, 12, 15, "28.03.2026 בשעה 12:15")]   // across the change to summer time on 27.03: same clock time
    [InlineData(10, 20, 9, 0, "28.10.2026 בשעה 09:00")]    // across the change to winter time on 25.10
    public void A_coupon_is_valid_for_eight_full_days_shown_in_Israel_time(int month, int day, int hour, int minute, string expected)
    {
        var issued = Il(month, day, hour, minute);
        var expires = ChallengeRules.ExpiresAt(issued, 8);
        Assert.Equal(expected, ChallengeRules.FormatIsrael(expires));
        Assert.Equal(DateTimeKind.Utc, expires.Kind);
    }

    [Fact]
    public void Eight_days_are_192_hours_when_no_clock_change_falls_inside()
    {
        var issued = new DateTime(2026, 1, 10, 8, 0, 0, DateTimeKind.Utc);
        Assert.Equal(TimeSpan.FromHours(192), ChallengeRules.ExpiresAt(issued, 8) - issued);
        Assert.Equal(TimeSpan.FromHours(192), ChallengeRules.ExpiresAt(new DateTime(2026, 6, 1, 21, 30, 0, DateTimeKind.Utc), 8) - new DateTime(2026, 6, 1, 21, 30, 0, DateTimeKind.Utc));
    }

    [Fact]
    public void A_coupon_expires_exactly_at_its_expiry_moment()
    {
        var end = new DateTime(2026, 3, 9, 8, 0, 0, DateTimeKind.Utc);
        Assert.False(ChallengeRules.IsExpired(end, end.AddTicks(-1)));
        Assert.True(ChallengeRules.IsExpired(end, end));
        Assert.True(ChallengeRules.IsExpired(end, end.AddSeconds(1)));
    }

    [Fact]
    public void Ten_percent_of_88_is_8_80_and_79_20_is_paid()
    {
        Assert.Equal((8.80m, 79.20m), CouponService.Price(88m, CouponKind.Percent, 10m));
    }

    [Fact]
    public void Codes_are_random_unique_and_readable()
    {
        var codes = Enumerable.Range(0, 20000).Select(_ => ChallengeRules.NewCode()).ToList();
        Assert.Equal(codes.Count, codes.Distinct().Count());
        Assert.All(codes, c => Assert.Matches("^PX-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$", c));
        // the existing checkout accepts the code as it is
        Assert.Equal(codes[0], CouponService.Normalize(" " + codes[0].ToLowerInvariant() + " "));
    }

    [Fact]
    public void An_address_is_masked_for_the_screen()
    {
        Assert.Equal("d***@gmail.com", ChallengeRules.MaskEmail("dana@gmail.com"));
        Assert.Equal("a*@x.org", ChallengeRules.MaskEmail("ab@x.org"));
    }

    [Fact]
    public void The_email_carries_the_code_the_discount_and_the_expiry_without_holiday_wording()
    {
        var m = new ChallengeEmailModel("PX-ABCD2345", 10m, new DateTime(2026, 3, 9, 8, 0, 0, DateTimeKind.Utc), 8, 240, "https://portalx.test", "info@portalx.test", null);
        var html = ChallengeEmailTemplate.Html(m);
        var text = ChallengeEmailTemplate.Text(m);
        foreach (var body in new[] { html, text })
        {
            Assert.Contains("PX-ABCD2345", body);
            Assert.Contains("09.03.2026 בשעה 10:00", body);
            Assert.Contains("10% הנחה", body);
            Assert.Contains("יותר מ-240 נקודות", body);
            Assert.Contains("ההטבה מוגבלת ל-8 ימים", body);
            Assert.DoesNotContain("חנוכה", body);
        }
        Assert.Equal("הצלחתם באתגר PORTAL X! הקופון שלכם מחכה לכם!", ChallengeEmailTemplate.Subject);
    }
}

/// <summary>"Challenge 240" end to end: eligibility, issuing, quota, email, checkout and the admin (spec 18–19).</summary>
[Collection(DatabaseCollection.Name)]
public class ChallengeTests
{
    private const string OtherProduct = "test-challenge-other";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HubIntegrationTests.Factory _factory;

    public ChallengeTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private (WebApplicationFactory<Program> F, FakeEmailSender Mail) WithMail()
    {
        var mail = new FakeEmailSender();
        var f = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["PORTALX_SITE_URL"] = "https://portalx.test" }));
            b.ConfigureTestServices(s => s.AddSingleton<IEmailSender>(mail));
        });
        return (f, mail);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>(Json);
    private static string Email(string name) => $"{name}.{Guid.NewGuid():N}"[..20].ToLowerInvariant() + "@example.org";

    private static async Task<HttpClient> AdminAsync(WebApplicationFactory<Program> f)
    {
        var http = f.CreateClient();
        (await http.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        http.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return http;
    }

    private static async Task<T> DbAsync<T>(WebApplicationFactory<Program> f, Func<PortalDbContext, Task<T>> q)
    {
        using var scope = f.Services.CreateScope();
        return await q(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    private static async Task EnsureOtherProductAsync(WebApplicationFactory<Program> f) => await DbAsync(f, async db =>
    {
        if (await db.Products.AnyAsync(p => p.Id == OtherProduct)) return 0;
        db.Products.Add(new Product
        {
            Id = OtherProduct, Name = "משחק שאינו באתגר", PriceIls = 70m, Status = ProductStatus.Published, ScenarioId = "last-portal",
            MinPlayers = 1, MaxPlayers = 4, SortOrder = 98, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });
        try { await db.SaveChangesAsync(); } catch (DbUpdateException) { }
        return 0;
    });

    /// <summary>The campaign on, for the test product only, with room for `room` more coupons.</summary>
    private static async Task<JsonElement> SetUpCampaignAsync(WebApplicationFactory<Program> f, int room = 50, decimal discount = 10m)
    {
        await TestPurchase.EnsureProductAsync(f.Services);
        await EnsureOtherProductAsync(f);
        var admin = await AdminAsync(f);
        var view = await Body(await admin.GetAsync("/api/admin/challenge"));
        var issued = view.GetProperty("campaign").GetProperty("issuedCouponsCount").GetInt32();
        var put = await admin.PutAsJsonAsync("/api/admin/challenge", new
        {
            name = "אתגר 240", minimumScore = 241, discountPercentage = discount, validityDays = 8, maxCoupons = issued + room,
            sourceProductId = "gate-of-secrets", productIds = new[] { TestPurchase.ProductId }, showEntryPopup = true, showProgress = true,
        });
        Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());
        (await admin.PostAsJsonAsync("/api/admin/challenge/issuing", new { paused = false })).EnsureSuccessStatusCode();
        var on = await admin.PostAsJsonAsync("/api/admin/challenge/active", new { active = true });
        Assert.True(on.IsSuccessStatusCode, await on.Content.ReadAsStringAsync());
        return await Body(on);
    }

    private sealed record Seat(Guid Id, string Token);

    /// <summary>A free game opened and joined through the API, then ended by the server with these personal scores.</summary>
    private static async Task<(string Code, List<Seat> Seats)> FreeGameAsync(WebApplicationFactory<Program> f, int[] scores, bool finish = true, bool success = true)
    {
        var http = f.CreateClient();
        var g = await Body(await http.PostAsync("/api/products/gate-of-secrets/free-game", null));
        var (code, claim) = (g.GetProperty("code").GetString()!, g.GetProperty("hostClaim").GetString()!);
        var seats = new List<Seat>();
        for (var i = 0; i < scores.Length; i++)
        {
            var j = await Body(await f.CreateClient().PostAsJsonAsync($"/api/rooms/{code}/players",
                new { nickname = "שחקן" + i, characterId = GameEngine.Characters[i], appearance = "{}", hostClaim = i == 0 ? claim : null }));
            seats.Add(new Seat(j.GetProperty("playerId").GetGuid(), j.GetProperty("token").GetString()!));
        }
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var engine = scope.ServiceProvider.GetRequiredService<GameEngine>();
        var room = await db.Rooms.Include(r => r.Players).Include(r => r.Puzzles).FirstAsync(r => r.Code == code);
        var now = DateTime.UtcNow;
        var world = GameEngine.World(room);
        world.Score = new ScoreBoard { Group = 250 };
        for (var i = 0; i < scores.Length; i++) world.Score.Personal[seats[i].Id.ToString()] = scores[i];
        room.StartedAt = now.AddMinutes(-12);
        room.FirstStartedAt = room.StartedAt;
        if (finish)
        {
            foreach (var p in room.Puzzles) { p.Status = PuzzleStatus.Solved; p.SolvedAt = now; }
            room.Phase = RoomPhase.Completed;
            room.EndedAt = now;
            var result = engine.BuildResult(room);
            if (!success) result.CompletionType = "timeout";
            db.Results.Add(result);
        }
        else room.Phase = RoomPhase.Playing;
        GameEngine.SaveWorld(room, world, now);
        await db.SaveChangesAsync();
        return (code, seats);
    }

    private static Task<HttpResponseMessage> Status(HttpClient http, string code, Seat s) =>
        http.PostAsJsonAsync($"/api/challenge/rooms/{code}/status", new { token = s.Token });

    private static Task<HttpResponseMessage> Issue(HttpClient http, string code, Seat s, string email, bool consent = false) =>
        http.PostAsJsonAsync($"/api/challenge/rooms/{code}/coupon", new { token = s.Token, email, marketingConsent = consent });

    private static Task<HttpResponseMessage> Check(HttpClient http, string product, string code) =>
        http.PostAsJsonAsync("/api/coupons/check", new { productId = product, code });

    // ------------------------------------------------------------------ eligibility

    [Fact]
    public async Task Only_a_finished_successful_free_game_with_more_than_240_points_is_eligible()
    {
        var (f, _) = WithMail();
        await SetUpCampaignAsync(f);
        var http = f.CreateClient();

        var (code, seats) = await FreeGameAsync(f, [240, 241]);
        var low = await Body(await Status(http, code, seats[0]));
        Assert.Equal("not-eligible", low.GetProperty("state").GetString());
        Assert.Equal(240, low.GetProperty("score").GetInt32());
        var high = await Body(await Status(http, code, seats[1]));
        Assert.Equal("eligible", high.GetProperty("state").GetString());
        Assert.Equal(241, high.GetProperty("score").GetInt32());
        // the 240-point player cannot get a coupon by asking for one directly
        Assert.Equal(HttpStatusCode.Conflict, (await Issue(http, code, seats[0], Email("low"))).StatusCode);

        // the server's score counts, whatever the browser claims
        var forged = await http.PostAsJsonAsync($"/api/challenge/rooms/{code}/coupon", new { token = seats[0].Token, email = Email("forged"), score = 999 });
        Assert.Equal(HttpStatusCode.Conflict, forged.StatusCode);

        var (playing, inPlay) = await FreeGameAsync(f, [300], finish: false);
        Assert.Equal("not-finished", (await Body(await Status(http, playing, inPlay[0]))).GetProperty("state").GetString());
        var (failed, lost) = await FreeGameAsync(f, [300], success: false);
        Assert.Equal("not-completed", (await Body(await Status(http, failed, lost[0]))).GetProperty("state").GetString());

        // someone who is not in the game cannot ask for it
        Assert.Equal(HttpStatusCode.Forbidden, (await http.PostAsJsonAsync($"/api/challenge/rooms/{code}/status", new { token = "not-a-seat" })).StatusCode);

        // the eligibility is stored with the server's score
        var rows = await DbAsync(f, db => db.PlayerCouponEligibility.AsNoTracking().Where(e => e.RoomId == db.Rooms.First(r => r.Code == code).Id).ToListAsync());
        Assert.Equal(2, rows.Count);
        Assert.Contains(rows, r => r.FinalScore == 241 && r.IsEligible);
        Assert.Contains(rows, r => r.FinalScore == 240 && !r.IsEligible);
    }

    [Fact]
    public async Task A_paid_game_does_not_take_part_in_the_challenge()
    {
        var (f, _) = WithMail();
        await SetUpCampaignAsync(f);
        var http = f.CreateClient();
        var (code, claim) = await TestPurchase.PaidRoomAsync(http, f.Services);
        var j = await Body(await f.CreateClient().PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname = "קונה", characterId = GameEngine.Characters[0], appearance = "{}", hostClaim = claim }));
        var state = await Body(await http.PostAsJsonAsync($"/api/challenge/rooms/{code}/status", new { token = j.GetProperty("token").GetString() }));
        Assert.Equal("inactive", state.GetProperty("state").GetString());   // no campaign has this game as its source
    }

    // ------------------------------------------------------------------ issuing

    [Fact]
    public async Task An_eligible_player_gets_one_personal_coupon_by_email_valid_for_eight_days()
    {
        var (f, mail) = WithMail();
        await SetUpCampaignAsync(f);
        var http = f.CreateClient();
        var (code, seats) = await FreeGameAsync(f, [300]);
        var email = Email("winner");
        var before = DateTime.UtcNow;
        var res = await Issue(http, code, seats[0], email.ToUpperInvariant());
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
        var body = await Body(res);
        Assert.Equal("issued", body.GetProperty("state").GetString());
        var coupon = body.GetProperty("coupon");
        var couponCode = coupon.GetProperty("code").GetString()!;
        Assert.Matches("^PX-[A-Z0-9]{8}$", couponCode);
        Assert.Equal(10m, coupon.GetProperty("discountPercent").GetDecimal());
        Assert.Equal("sent", coupon.GetProperty("emailStatus").GetString());

        var stored = await DbAsync(f, db => db.Coupons.AsNoTracking().Include(c => c.Products).FirstAsync(c => c.Code == couponCode));
        Assert.Equal(email, stored.Email);
        Assert.Equal(1, stored.MaxRedemptions);
        Assert.Equal(300, stored.FinalScore);
        Assert.Equal(ChallengeRules.ExpiresAt(stored.CreatedAt, 8), stored.EndsAt);
        Assert.InRange(stored.EndsAt!.Value - before, TimeSpan.FromHours(191), TimeSpan.FromHours(193));
        Assert.Equal([TestPurchase.ProductId], stored.Products.Select(p => p.ProductId));

        // the email went to the address, with the code and the expiry in Israel time
        var sent = Assert.Single(mail.Sent, m => m.To == email);
        Assert.Equal(ChallengeEmailTemplate.Subject, sent.Subject);
        Assert.Contains(couponCode, sent.Html);
        Assert.Contains(ChallengeRules.FormatIsrael(stored.EndsAt.Value), sent.Html);
        Assert.Contains(ChallengeRules.FormatIsrael(stored.EndsAt.Value), coupon.GetProperty("expiresAtText").GetString());

        // a refresh: the same coupon again
        var again = await Body(await Status(f.CreateClient(), code, seats[0]));
        Assert.Equal("issued", again.GetProperty("state").GetString());
        Assert.Equal(couponCode, again.GetProperty("coupon").GetProperty("code").GetString());
        // the email is masked on the screen
        Assert.DoesNotContain(email, again.GetProperty("coupon").GetProperty("email").GetString());
        var events = await DbAsync(f, db => db.CouponEvents.AsNoTracking().Where(e => e.CouponId == stored.Id).Select(e => e.Action).ToListAsync());
        Assert.Equal(["issued", "email-sent"], events);
    }

    [Fact]
    public async Task Asking_again_never_issues_a_second_coupon_and_an_address_gets_only_one()
    {
        var (f, _) = WithMail();
        await SetUpCampaignAsync(f);
        var http = f.CreateClient();
        var (code, seats) = await FreeGameAsync(f, [260, 270]);
        var email = Email("once");
        var first = (await Body(await Issue(http, code, seats[0], email))).GetProperty("coupon").GetProperty("code").GetString();
        var second = (await Body(await Issue(http, code, seats[0], Email("other")))).GetProperty("coupon").GetProperty("code").GetString();
        Assert.Equal(first, second);
        // the other player cannot use the same address
        var dup = await Issue(http, code, seats[1], email);
        Assert.Equal(HttpStatusCode.Conflict, dup.StatusCode);
        Assert.Equal("email-used", (await Body(dup)).GetProperty("code").GetString());
        Assert.Equal(1, await DbAsync(f, db => db.Coupons.CountAsync(c => c.PlayerId == seats[0].Id)));
    }

    [Fact]
    public async Task Parallel_requests_from_many_tabs_issue_exactly_one_coupon()
    {
        var (f, _) = WithMail();
        await SetUpCampaignAsync(f);
        var (code, seats) = await FreeGameAsync(f, [320]);
        var email = Email("tabs");
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Issue(f.CreateClient(), code, seats[0], email)));
        var codes = new List<string>();
        foreach (var r in results)
        {
            Assert.True(r.IsSuccessStatusCode, await r.Content.ReadAsStringAsync());
            codes.Add((await Body(r)).GetProperty("coupon").GetProperty("code").GetString()!);
        }
        Assert.Single(codes.Distinct());
        Assert.Equal(1, await DbAsync(f, db => db.Coupons.CountAsync(c => c.Email == email)));
    }

    [Fact]
    public async Task The_quota_is_never_passed_also_under_parallel_requests()
    {
        var (f, _) = WithMail();
        var view = await SetUpCampaignAsync(f, room: 2);
        var campaignId = view.GetProperty("campaign").GetProperty("id").GetGuid();
        var issuedBefore = view.GetProperty("campaign").GetProperty("issuedCouponsCount").GetInt32();
        var (code, seats) = await FreeGameAsync(f, [300, 300, 300, 300]);
        var results = await Task.WhenAll(seats.Select((s, i) => Issue(f.CreateClient(), code, s, Email("quota" + i))));
        Assert.Equal(2, results.Count(r => r.IsSuccessStatusCode));
        foreach (var r in results.Where(r => !r.IsSuccessStatusCode)) Assert.Equal("quota-full", (await Body(r)).GetProperty("code").GetString());
        var campaign = await DbAsync(f, db => db.CouponCampaigns.AsNoTracking().FirstAsync(c => c.Id == campaignId));
        Assert.Equal(issuedBefore + 2, campaign.IssuedCouponsCount);
        Assert.Equal(campaign.MaxCoupons, campaign.IssuedCouponsCount);
        var without = seats[results.ToList().FindIndex(r => !r.IsSuccessStatusCode)];
        Assert.Equal("quota-full", (await Body(await Status(f.CreateClient(), code, without))).GetProperty("state").GetString());
    }

    [Fact]
    public async Task A_disabled_or_paused_campaign_issues_nothing_and_shows_no_popup()
    {
        var (f, _) = WithMail();
        await SetUpCampaignAsync(f);
        var admin = await AdminAsync(f);
        var http = f.CreateClient();
        var (code, seats) = await FreeGameAsync(f, [300, 300]);

        (await admin.PostAsJsonAsync("/api/admin/challenge/issuing", new { paused = true })).EnsureSuccessStatusCode();
        Assert.Equal("paused", (await Body(await Status(http, code, seats[0]))).GetProperty("state").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await Issue(http, code, seats[0], Email("paused"))).StatusCode);
        (await admin.PostAsJsonAsync("/api/admin/challenge/issuing", new { paused = false })).EnsureSuccessStatusCode();

        (await admin.PostAsJsonAsync("/api/admin/challenge/active", new { active = false })).EnsureSuccessStatusCode();
        Assert.False((await Body(await http.GetAsync("/api/challenge"))).GetProperty("active").GetBoolean());
        Assert.Equal("inactive", (await Body(await Status(http, code, seats[0]))).GetProperty("state").GetString());
        var refused = await Issue(http, code, seats[0], Email("off"));
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal(0, await DbAsync(f, db => db.Coupons.CountAsync(c => c.PlayerId == seats[0].Id)));

        (await admin.PostAsJsonAsync("/api/admin/challenge/active", new { active = true })).EnsureSuccessStatusCode();
        var pub = await Body(await http.GetAsync("/api/challenge"));
        Assert.True(pub.GetProperty("active").GetBoolean());
        Assert.Equal(241, pub.GetProperty("minimumScore").GetInt32());
        Assert.False(pub.TryGetProperty("issuedCouponsCount", out _));   // never the counts
    }

    // ------------------------------------------------------------------ consent

    [Fact]
    public async Task Marketing_consent_is_optional_and_stored_apart_from_the_coupon()
    {
        var (f, _) = WithMail();
        await SetUpCampaignAsync(f);
        var http = f.CreateClient();
        var (code, seats) = await FreeGameAsync(f, [300, 300]);
        var yes = Email("yes");
        var no = Email("no");
        Assert.True((await Issue(http, code, seats[0], yes, consent: true)).IsSuccessStatusCode);
        Assert.True((await Issue(http, code, seats[1], no, consent: false)).IsSuccessStatusCode);

        var consent = await DbAsync(f, db => db.MarketingConsents.AsNoTracking().FirstAsync(c => c.Email == yes));
        Assert.Equal(ConsentStatus.Active, consent.Status);
        Assert.Equal(ChallengeService.ConsentSource, consent.Source);
        Assert.Equal(ChallengeService.ConsentVersion, consent.ConsentVersion);
        Assert.Equal(ChallengeService.ConsentText, consent.ConsentText);
        Assert.False(await DbAsync(f, db => db.MarketingConsents.AnyAsync(c => c.Email == no)));

        var rows = await DbAsync(f, db => db.PlayerCouponEligibility.AsNoTracking().Where(e => e.Email == yes || e.Email == no).ToListAsync());
        var granted = rows.Single(r => r.Email == yes);
        Assert.True(granted.MarketingConsent);
        Assert.NotNull(granted.ConsentAt);
        Assert.Equal(ChallengeService.ConsentVersion, granted.ConsentVersion);
        Assert.Equal(ChallengeService.ConsentSource, granted.ConsentSource);
        var refused = rows.Single(r => r.Email == no);
        Assert.False(refused.MarketingConsent);
        Assert.Null(refused.ConsentAt);
    }

    // ------------------------------------------------------------------ email

    [Fact]
    public async Task A_failed_email_can_be_sent_again_with_the_same_coupon()
    {
        var (f, mail) = WithMail();
        await SetUpCampaignAsync(f);
        var http = f.CreateClient();
        var (code, seats) = await FreeGameAsync(f, [300]);
        var email = Email("retry");
        mail.Transient = false;
        mail.FailNext = 1;
        var issued = await Body(await Issue(http, code, seats[0], email));
        var couponCode = issued.GetProperty("coupon").GetProperty("code").GetString()!;
        Assert.Equal("failed", issued.GetProperty("coupon").GetProperty("emailStatus").GetString());
        Assert.DoesNotContain(mail.Sent, m => m.To == email);

        // right away: asked to wait a minute
        Assert.Equal((HttpStatusCode)429, (await http.PostAsJsonAsync($"/api/challenge/rooms/{code}/resend", new { token = seats[0].Token })).StatusCode);
        await DbAsync(f, db => db.Coupons.Where(c => c.Code == couponCode).ExecuteUpdateAsync(s => s.SetProperty(c => c.EmailLastAttemptAt, DateTime.UtcNow.AddMinutes(-5))));
        var resent = await http.PostAsJsonAsync($"/api/challenge/rooms/{code}/resend", new { token = seats[0].Token });
        Assert.True(resent.IsSuccessStatusCode, await resent.Content.ReadAsStringAsync());
        var after = await Body(resent);
        Assert.Equal(couponCode, after.GetProperty("coupon").GetProperty("code").GetString());
        Assert.Equal("sent", after.GetProperty("coupon").GetProperty("emailStatus").GetString());
        Assert.Contains(couponCode, Assert.Single(mail.Sent, m => m.To == email).Html);
        Assert.Equal(1, await DbAsync(f, db => db.Coupons.CountAsync(c => c.Email == email)));
    }

    // ------------------------------------------------------------------ checkout

    private async Task<(WebApplicationFactory<Program> F, string Coupon)> CouponAsync(int score = 300)
    {
        var (f, _) = WithMail();
        await SetUpCampaignAsync(f);
        var (code, seats) = await FreeGameAsync(f, [score]);
        var body = await Body(await Issue(f.CreateClient(), code, seats[0], Email("buyer")));
        return (f, body.GetProperty("coupon").GetProperty("code").GetString()!);
    }

    [Fact]
    public async Task The_coupon_gives_its_discount_on_the_chosen_games_only()
    {
        var (f, coupon) = await CouponAsync();
        var http = f.CreateClient();
        var ok = await Body(await Check(http, TestPurchase.ProductId, coupon.ToLowerInvariant()));
        Assert.Equal(TestPurchase.Price, ok.GetProperty("originalPrice").GetDecimal());
        Assert.Equal(5.00m, ok.GetProperty("discount").GetDecimal());
        Assert.Equal(45.00m, ok.GetProperty("finalPrice").GetDecimal());

        var other = await Check(http, OtherProduct, coupon);
        Assert.False(other.IsSuccessStatusCode);
        Assert.Equal(CouponService.WrongProductMessage, (await Body(other)).GetProperty("message").GetString());
        Assert.False((await Check(http, "gate-of-secrets", coupon)).IsSuccessStatusCode);
    }

    [Fact]
    public async Task The_coupon_is_redeemed_once_by_a_paid_order_and_a_failed_payment_does_not_use_it()
    {
        var (f, coupon) = await CouponAsync();
        var http = f.CreateClient();

        // a payment that fails: the coupon stays unused
        var first = await Body(await http.PostAsJsonAsync("/api/orders", new { productId = TestPurchase.ProductId, couponCode = coupon }));
        var url1 = first.GetProperty("checkoutUrl").GetString()!;
        (await http.PostAsJsonAsync($"/api/sandbox/checkout/{url1[(url1.LastIndexOf('/') + 1)..]}", new { outcome = "decline" })).EnsureSuccessStatusCode();
        Assert.True((await Check(http, TestPurchase.ProductId, coupon)).IsSuccessStatusCode);

        // a paid order: redeemed, with the order and the time
        var second = await Body(await http.PostAsJsonAsync("/api/orders", new { productId = TestPurchase.ProductId, couponCode = coupon }));
        Assert.Equal(45m, second.GetProperty("price").GetDecimal());
        var url2 = second.GetProperty("checkoutUrl").GetString()!;
        (await http.PostAsJsonAsync($"/api/sandbox/checkout/{url2[(url2.LastIndexOf('/') + 1)..]}", new { outcome = "approve" })).EnsureSuccessStatusCode();

        var used = await Check(http, TestPurchase.ProductId, coupon);
        Assert.False(used.IsSuccessStatusCode);
        Assert.Equal(CouponService.RedeemedMessage, (await Body(used)).GetProperty("message").GetString());
        Assert.False((await http.PostAsJsonAsync("/api/orders", new { productId = TestPurchase.ProductId, couponCode = coupon })).IsSuccessStatusCode);

        var admin = await AdminAsync(f);
        var row = (await Body(await admin.GetAsync($"/api/admin/challenge/coupons?search={coupon.ToLowerInvariant()}"))).EnumerateArray().Single();
        Assert.Equal("redeemed", row.GetProperty("status").GetString());
        Assert.Equal(second.GetProperty("number").GetInt64(), row.GetProperty("orderNumber").GetInt64());
        Assert.Equal("מוצר בדיקה", row.GetProperty("purchasedGame").GetString());
        Assert.NotEqual(JsonValueKind.Null, row.GetProperty("redeemedAt").ValueKind);
        // a redeemed coupon cannot be cancelled
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync($"/api/admin/challenge/coupons/{row.GetProperty("id").GetGuid()}/cancel", null)).StatusCode);
    }

    [Fact]
    public async Task Two_buyers_at_once_cannot_both_use_one_personal_coupon()
    {
        var (f, coupon) = await CouponAsync();
        var results = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => f.CreateClient()
            .PostAsJsonAsync("/api/orders", new { productId = TestPurchase.ProductId, couponCode = coupon })));
        Assert.Single(results, r => r.IsSuccessStatusCode);
    }

    [Fact]
    public async Task An_expired_or_cancelled_coupon_is_refused_at_checkout()
    {
        var (f, coupon) = await CouponAsync();
        var http = f.CreateClient();
        await DbAsync(f, db => db.Coupons.Where(c => c.Code == coupon).ExecuteUpdateAsync(s => s.SetProperty(c => c.EndsAt, DateTime.UtcNow)));
        var expired = await Check(http, TestPurchase.ProductId, coupon);
        Assert.Equal(CouponService.ExpiredMessage, (await Body(expired)).GetProperty("message").GetString());

        var (f2, other) = await CouponAsync();
        var admin = await AdminAsync(f2);
        var row = (await Body(await admin.GetAsync($"/api/admin/challenge/coupons?search={other.ToLowerInvariant()}"))).EnumerateArray().Single();
        var cancel = await admin.PostAsync($"/api/admin/challenge/coupons/{row.GetProperty("id").GetGuid()}/cancel", null);
        Assert.True(cancel.IsSuccessStatusCode, await cancel.Content.ReadAsStringAsync());
        var detail = await Body(cancel);
        Assert.Equal("cancelled", detail.GetProperty("status").GetString());
        Assert.Contains(detail.GetProperty("events").EnumerateArray(), e => e.GetProperty("action").GetString() == "cancelled");
        Assert.Equal(CouponService.CancelledMessage, (await Body(await Check(f2.CreateClient(), TestPurchase.ProductId, other))).GetProperty("message").GetString());
        Assert.True(await DbAsync(f2, db => db.AdminAuditLog.AnyAsync(a => a.Action == "challenge-coupon-cancelled" && a.TargetId == row.GetProperty("id").GetGuid().ToString())));
    }

    [Fact]
    public async Task Changing_the_campaign_never_changes_coupons_already_issued()
    {
        var (f, coupon) = await CouponAsync();
        var before = await DbAsync(f, db => db.Coupons.AsNoTracking().Include(c => c.Products).FirstAsync(c => c.Code == coupon));
        var admin = await AdminAsync(f);
        var put = await admin.PutAsJsonAsync("/api/admin/challenge", new { discountPercentage = 25m, validityDays = 3, productIds = new[] { TestPurchase.ProductId, OtherProduct } });
        Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());
        var after = await DbAsync(f, db => db.Coupons.AsNoTracking().Include(c => c.Products).FirstAsync(c => c.Code == coupon));
        Assert.Equal(before.Value, after.Value);
        Assert.Equal(10m, after.Value);
        Assert.Equal(before.EndsAt, after.EndsAt);
        Assert.Equal([TestPurchase.ProductId], after.Products.Select(p => p.ProductId));
        Assert.False((await Check(f.CreateClient(), OtherProduct, coupon)).IsSuccessStatusCode);
        // the change is in the audit log with what it was before
        Assert.True(await DbAsync(f, db => db.AdminAuditLog.AnyAsync(a => a.Action == "challenge-updated")));
        await SetUpCampaignAsync(f);   // back to the usual settings for the other tests
    }

    // ------------------------------------------------------------------ the admin

    [Fact]
    public async Task Only_the_admin_reaches_the_challenge_settings_list_and_export()
    {
        var (f, _) = WithMail();
        var visitor = f.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.GetAsync("/api/admin/challenge")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.PutAsJsonAsync("/api/admin/challenge", new { discountPercentage = 90 })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.PostAsJsonAsync("/api/admin/challenge/active", new { active = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.GetAsync("/api/admin/challenge/coupons")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.GetAsync("/api/admin/challenge/coupons.csv")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.PostAsync($"/api/admin/challenge/coupons/{Guid.NewGuid()}/cancel", null)).StatusCode);
    }

    [Fact]
    public async Task The_admin_sees_figures_list_details_and_can_export()
    {
        var (f, _) = WithMail();
        await SetUpCampaignAsync(f);
        var (code, seats) = await FreeGameAsync(f, [300, 100]);
        var http = f.CreateClient();
        var email = Email("report");
        await Status(http, code, seats[1]);
        (await Issue(http, code, seats[0], email, consent: true)).EnsureSuccessStatusCode();
        var admin = await AdminAsync(f);
        var view = await Body(await admin.GetAsync("/api/admin/challenge"));
        var st = view.GetProperty("statistics");
        foreach (var k in new[] { "gamesStarted", "gamesCompleted", "uniqueParticipants", "eligiblePlayers", "emailsCollected", "marketingConsents", "issued", "remaining", "redeemed", "revenue", "discounts" })
            Assert.True(st.TryGetProperty(k, out _), k);
        Assert.True(st.GetProperty("issued").GetInt32() >= 1);
        Assert.True(st.GetProperty("eligiblePlayers").GetInt32() >= 1);

        var list = await Body(await admin.GetAsync($"/api/admin/challenge/coupons?search={email}&status=active"));
        var row = list.EnumerateArray().Single();
        Assert.Equal(300, row.GetProperty("score").GetInt32());
        Assert.True(row.GetProperty("marketingConsent").GetBoolean());
        var detail = await Body(await admin.GetAsync($"/api/admin/challenge/coupons/{row.GetProperty("id").GetGuid()}"));
        Assert.Equal(email, detail.GetProperty("email").GetString());
        Assert.True(detail.GetProperty("consent").GetProperty("marketingConsent").GetBoolean());

        var csv = await admin.GetAsync($"/api/admin/challenge/coupons.csv?search={email}");
        Assert.True(csv.IsSuccessStatusCode);
        var text = await csv.Content.ReadAsStringAsync();
        Assert.Contains(row.GetProperty("code").GetString()!, text);
        Assert.Contains("קוד קופון", text);

        // the ordinary coupon screen does not list personal coupons
        var ordinary = await Body(await admin.GetAsync("/api/admin/coupons"));
        Assert.DoesNotContain(ordinary.EnumerateArray(), c => c.GetProperty("code").GetString() == row.GetProperty("code").GetString());
    }

    [Fact]
    public async Task The_campaign_cannot_be_switched_on_without_games_and_a_quota_and_refuses_bad_values()
    {
        var (f, _) = WithMail();
        await SetUpCampaignAsync(f);
        var admin = await AdminAsync(f);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/admin/challenge", new { discountPercentage = 100m })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/admin/challenge", new { validityDays = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/admin/challenge", new { productIds = new[] { "gate-of-secrets" } })).StatusCode);
        // an active campaign must keep at least one game
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/admin/challenge", new { productIds = Array.Empty<string>() })).StatusCode);
        var view = await Body(await admin.GetAsync("/api/admin/challenge"));
        var issued = view.GetProperty("campaign").GetProperty("issuedCouponsCount").GetInt32();
        if (issued > 0) Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/admin/challenge", new { maxCoupons = issued - 1 })).StatusCode);
    }
}
