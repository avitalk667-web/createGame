using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Challenge;
using PortalX.Server.Data;
using PortalX.Server.Demo;
using PortalX.Server.Domain;
using PortalX.Server.Mail;
using PortalX.Server.Referrals;

namespace PortalX.Tests;

/// <summary>
/// "טעימה מהפורטל" (/demo): an anonymous session per browser cookie, the riddle checked only on the server, every
/// counter that matters counted once (objects, hints, the completion), and no browser able to touch another's session.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class DemoTests(HubIntegrationTests.Factory factory)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private sealed record StateReply(DemoState? State);

    private HttpClient Browser() => factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    private static async Task<DemoState> StateOf(HttpResponseMessage r)
    {
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<StateReply>(Json))!.State!;
    }

    private static async Task<DemoCodeReply> Code(HttpClient c, string code)
    {
        var r = await c.PostAsJsonAsync("/api/taste/code", new { code });
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<DemoCodeReply>(Json))!;
    }

    private async Task<T> Db<T>(Func<PortalDbContext, Task<T>> q)
    {
        using var scope = factory.Services.CreateScope();
        return await q(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    /// <summary>The session's id, found by its newest demo_started event for this test (sessions are anonymous).</summary>
    private async Task<Guid> LatestSessionAsync(DateTime since) =>
        await Db(db => db.DemoSessions.Where(s => s.CreatedAt >= since).OrderByDescending(s => s.CreatedAt).Select(s => s.Id).FirstAsync());

    [Fact]
    public async Task Starting_without_a_session_creates_one_and_a_refresh_continues_it()
    {
        var c = Browser();
        var before = await c.GetFromJsonAsync<StateReply>("/api/taste/state", Json);
        Assert.Null(before!.State);

        var since = DateTime.UtcNow.AddSeconds(-1);
        var first = await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { device = "mobile" }));
        Assert.Empty(first.Inspected);
        Assert.False(first.Completed);
        var id = await LatestSessionAsync(since);

        await StateOf(await c.PostAsJsonAsync("/api/taste/inspect", new { item = "compass" }));
        // a refresh: the same cookie continues the same session, with what was already examined
        var again = await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { device = "mobile" }));
        Assert.Equal(new[] { "compass" }, again.Inspected);
        var resumed = await c.GetFromJsonAsync<StateReply>("/api/taste/state", Json);
        Assert.Equal(new[] { "compass" }, resumed!.State!.Inspected);

        Assert.Equal(1, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_started")));
        Assert.Equal("mobile", await Db(db => db.DemoSessions.Where(s => s.Id == id).Select(s => s.Device).FirstAsync()));
    }

    [Fact]
    public async Task Each_object_is_recorded_once_and_unknown_objects_are_ignored()
    {
        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { device = "desktop" }));
        var id = await LatestSessionAsync(since);
        foreach (var item in new[] { "letter", "letter", "clock", "nonsense", "key", "compass", "clock" })
            await StateOf(await c.PostAsJsonAsync("/api/taste/inspect", new { item }));
        var state = await c.GetFromJsonAsync<StateReply>("/api/taste/state", Json);
        Assert.Equal(new[] { "letter", "compass", "clock", "key" }, state!.State!.Inspected);
        Assert.Equal(4, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_item_inspected")));
    }

    [Fact]
    public async Task At_most_two_hints_are_given_in_order()
    {
        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var id = await LatestSessionAsync(since);
        var one = await StateOf(await c.PostAsync("/api/taste/hint", null));
        Assert.Equal(new[] { DemoService.HintTexts[0] }, one.Hints);
        var two = await StateOf(await c.PostAsync("/api/taste/hint", null));
        var three = await StateOf(await c.PostAsync("/api/taste/hint", null));
        Assert.Equal(DemoService.HintTexts, two.Hints);
        Assert.Equal(DemoService.HintTexts, three.Hints);
        Assert.Equal(2, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_hint_requested")));
    }

    [Fact]
    public async Task Only_2741_opens_the_door_and_completion_counts_once()
    {
        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var id = await LatestSessionAsync(since);

        var wrong = await Code(c, "1247");
        Assert.False(wrong.Ok);
        Assert.Equal(DemoService.WrongMessage, wrong.Message);
        var notDigits = await Code(c, "27a1");
        Assert.False(notDigits.Ok);
        Assert.Equal(1, notDigits.State.Attempts);

        var right = await Code(c, "2741");
        Assert.True(right.Ok);
        Assert.False(right.AlreadyCompleted);
        Assert.True(right.State.Completed);
        Assert.Equal(DemoService.RightMessage, right.Message);

        // pressing again, or a wrong code after the door is open, changes nothing
        var again = await Code(c, "2741");
        Assert.True(again.Ok);
        Assert.True(again.AlreadyCompleted);
        var after = await Code(c, "0000");
        Assert.True(after.Ok);
        Assert.Equal(1, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_completed")));
        Assert.Equal(2, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_code_attempt")));
    }

    [Fact]
    public async Task Two_tabs_pressing_the_right_code_together_complete_once()
    {
        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var id = await LatestSessionAsync(since);
        var replies = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Code(c, "2741")));
        Assert.All(replies, r => Assert.True(r.Ok));
        Assert.Equal(1, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_completed")));
        Assert.Single(replies, r => !r.AlreadyCompleted);
    }

    [Fact]
    public async Task Repeated_wrong_codes_rest_the_keypad_briefly()
    {
        var c = Browser();
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        for (var i = 0; i < DemoService.WrongBeforeCooldown; i++) Assert.False((await Code(c, "1111")).Ok);
        var resting = await Code(c, "2741");
        Assert.False(resting.Ok);
        Assert.InRange(resting.State.CooldownSeconds, 1, (int)DemoService.Cooldown.TotalSeconds);
        Assert.Contains("שניות", resting.Message);
        Assert.False(resting.State.Completed);
    }

    [Fact]
    public async Task Without_its_cookie_a_browser_cannot_touch_any_session()
    {
        var owner = Browser();
        await StateOf(await owner.PostAsJsonAsync("/api/taste/start", new { }));
        var stranger = Browser();
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync("/api/taste/code", new { code = "2741" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync("/api/taste/inspect", new { item = "key" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsync("/api/taste/hint", null)).StatusCode);
        // a made-up cookie is no better
        var forged = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        forged.DefaultRequestHeaders.Add("Cookie", $"{DemoService.Cookie}=made-up-token");
        Assert.Equal(HttpStatusCode.NotFound, (await forged.PostAsJsonAsync("/api/taste/code", new { code = "2741" })).StatusCode);
        var mine = await owner.GetFromJsonAsync<StateReply>("/api/taste/state", Json);
        Assert.False(mine!.State!.Completed);
        Assert.Empty(mine.State.Inspected);
    }

    [Fact]
    public async Task The_cookie_is_http_only_and_lasts_a_week()
    {
        var c = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var r = await c.PostAsJsonAsync("/api/taste/start", new { });
        var cookie = r.Headers.GetValues("Set-Cookie").Single(h => h.StartsWith(DemoService.Cookie + "="));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("max-age=604800", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);
    }

    // ------------------------------------------------------------------ stage E: the funnel and the attribution

    private static Task<HttpResponseMessage> Report(HttpClient c, string type, string? productId = null) =>
        c.PostAsJsonAsync("/api/taste/event", new { type, productId, device = "mobile" });

    private Task<List<string>> EventsOf(Guid session) =>
        Db(db => db.DemoEvents.Where(e => e.SessionId == session).OrderBy(e => e.Id).Select(e => e.Type).ToListAsync());

    [Fact]
    public async Task The_browser_may_report_only_the_steps_it_alone_sees()
    {
        var c = Browser();
        Assert.Equal(HttpStatusCode.BadRequest, (await Report(c, "demo_completed")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Report(c, "demo_purchase_completed")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Report(c, "anything")).StatusCode);

        // before any session: the home page impression is kept without a session
        var since = DateTime.UtcNow.AddSeconds(-1);
        Assert.Equal(HttpStatusCode.NoContent, (await Report(c, "demo_impression")).StatusCode);
        var anon = await Db(db => db.DemoEvents.Where(e => e.Type == "demo_impression" && e.At >= since && e.SessionId == null).CountAsync());
        Assert.True(anon >= 1);
        // a session step without a session changes nothing (and never fails the page)
        Assert.Equal(HttpStatusCode.NoContent, (await Report(c, "demo_offer_viewed")).StatusCode);
    }

    [Fact]
    public async Task Offer_product_and_leaving_are_counted_once_per_session()
    {
        await TestPurchase.EnsureProductAsync(factory.Services);
        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var id = await LatestSessionAsync(since);

        await Report(c, "demo_abandoned");
        await Report(c, "demo_abandoned");
        await Code(c, "2741");
        await Report(c, "demo_abandoned"); // after solving it, leaving is not abandoning
        await Report(c, "demo_offer_viewed");
        await Report(c, "demo_offer_viewed");
        await Report(c, "demo_product_clicked", "no-such-game");
        await Report(c, "demo_product_clicked", TestPurchase.ProductId);

        var events = await EventsOf(id);
        Assert.Single(events, e => e == "demo_abandoned");
        Assert.Single(events, e => e == "demo_offer_viewed");
        Assert.Single(events, e => e == "demo_product_clicked");
        var s = await Db(db => db.DemoSessions.AsNoTracking().FirstAsync(x => x.Id == id));
        Assert.NotNull(s.OfferViewedAt);
        Assert.NotNull(s.ProductClickedAt);
        Assert.Equal(TestPurchase.ProductId, s.ProductClickedId);
    }

    [Fact]
    public async Task The_portal_finale_steps_count_only_after_the_door_opened_once_per_session()
    {
        await TestPurchase.EnsureProductAsync(factory.Services);
        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var id = await LatestSessionAsync(since);

        // before the right code there is no finale: nothing is counted
        Assert.Equal(HttpStatusCode.NoContent, (await Report(c, "demo_finale_entered")).StatusCode);
        await Report(c, "demo_card_selected", TestPurchase.ProductId);
        Assert.DoesNotContain(await EventsOf(id), e => e is "demo_finale_entered" or "demo_card_selected");

        await Code(c, "2741");
        foreach (var step in new[] { "demo_finale_entered", "demo_portal_started", "demo_portal_completed", "demo_cards_displayed" })
        {
            Assert.Equal(HttpStatusCode.NoContent, (await Report(c, step)).StatusCode);
            await Report(c, step); // a refresh or a return visit reports it again
        }
        await Report(c, "demo_card_selected", "no-such-game");
        await Report(c, "demo_card_selected", TestPurchase.ProductId);

        var events = await EventsOf(id);
        Assert.Single(events, e => e == "demo_finale_entered");
        Assert.Single(events, e => e == "demo_portal_started");
        Assert.Single(events, e => e == "demo_portal_completed");
        Assert.Single(events, e => e == "demo_cards_displayed");
        var selected = await Db(db => db.DemoEvents.Where(e => e.SessionId == id && e.Type == "demo_card_selected").Select(e => e.ProductId).ToListAsync());
        Assert.Equal(TestPurchase.ProductId, Assert.Single(selected));
        // choosing a card is not opening the game: the session's click stays empty until the game page is opened
        Assert.Null(await Db(db => db.DemoSessions.Where(x => x.Id == id).Select(x => x.ProductClickedAt).FirstAsync()));
    }

    [Fact]
    public async Task A_personal_link_in_the_address_counts_for_the_session_only_when_the_server_knows_it()
    {
        var token = ReferralService.NewToken();
        var linkId = Guid.NewGuid();
        await Db(async db =>
        {
            db.ReferralLinks.Add(new ReferralLink
            {
                Id = linkId, Token = token, FirstName = "דנה", LastName = "טעימה", Email = $"demo.{Guid.NewGuid():N}@example.org"[..30],
                Status = ReferralLinkStatus.Active, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow, Source = ReferralService.Source,
            });
            return await db.SaveChangesAsync();
        });

        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        Assert.Equal(HttpStatusCode.NoContent, (await c.PostAsJsonAsync("/api/taste/ref", new { @ref = token })).StatusCode);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var id = await LatestSessionAsync(since);
        Assert.Equal(linkId, await Db(db => db.DemoSessions.Where(s => s.Id == id).Select(s => s.ReferralLinkId).FirstAsync()));

        // a made-up code sets nothing: no visit cookie, no link on the session
        var other = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var r = await other.PostAsJsonAsync("/api/taste/ref", new { @ref = ReferralService.NewToken() });
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.False(r.Headers.TryGetValues("Set-Cookie", out var set) && set.Any(h => h.StartsWith(ReferralService.VisitCookie + "=")));
    }

    [Fact]
    public async Task An_order_from_a_taste_session_is_attributed_and_counted_as_bought_only_when_paid()
    {
        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var id = await LatestSessionAsync(since);
        await Code(c, "2741");

        var order = await TestPurchase.CreateOrderAsync(c, factory.Services);
        Assert.Equal(id, await Db(db => db.Orders.Where(o => o.Id == order.OrderId).Select(o => o.DemoSessionId).FirstAsync()));
        var started = await Db(db => db.DemoSessions.AsNoTracking().FirstAsync(x => x.Id == id));
        Assert.NotNull(started.CheckoutStartedAt);
        Assert.Null(started.PurchasedAt); // creating an order is not buying
        Assert.DoesNotContain("demo_purchase_completed", await EventsOf(id));

        (await TestPurchase.PayAsync(c, order)).EnsureSuccessStatusCode();
        var paid = await Db(db => db.DemoSessions.AsNoTracking().FirstAsync(x => x.Id == id));
        Assert.NotNull(paid.PurchasedAt);
        Assert.Equal(order.OrderId, paid.OrderId);
        var bought = await Db(db => db.DemoEvents.Where(e => e.SessionId == id && e.Type == "demo_purchase_completed").ToListAsync());
        var e = Assert.Single(bought);
        Assert.Equal(TestPurchase.ProductId, e.ProductId);
        Assert.Equal((int)(TestPurchase.Price * 100), e.Value);
        Assert.Single(await EventsOf(id), x => x == "demo_checkout_started");

        // a browser without a taste session buys exactly as before, unattributed
        var plain = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        var other = await TestPurchase.CreateOrderAsync(plain, factory.Services);
        Assert.Null(await Db(db => db.Orders.Where(o => o.Id == other.OrderId).Select(o => o.DemoSessionId).FirstAsync()));
    }
    // ------------------------------------------------------------------ the coupon of a finished taste

    private (HttpClient Browser, FakeEmailSender Mail) BrowserWithMail()
    {
        var mail = new FakeEmailSender();
        var f = factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["PORTALX_SITE_URL"] = "https://portalx.test" }));
            b.ConfigureTestServices(s => s.AddSingleton<IEmailSender>(mail));
        });
        return (f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true }), mail);
    }

    private static async Task<(HttpStatusCode Status, JsonElement Body)> Post(HttpClient c, string url, object? body = null)
    {
        var r = body == null ? await c.PostAsync(url, null) : await c.PostAsJsonAsync(url, body);
        return (r.StatusCode, await r.Content.ReadFromJsonAsync<JsonElement>(Json));
    }

    private static string? Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    [Fact]
    public async Task The_coupon_needs_an_address_and_consent_and_its_code_shows_only_after_the_email_was_sent()
    {
        var (c, mail) = BrowserWithMail();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var id = await LatestSessionAsync(since);
        var address = $"taste.{Guid.NewGuid():N}"[..20] + "@example.org";

        // before the door opened: nothing
        Assert.Equal("not-completed", Str((await Post(c, "/api/taste/coupon/status")).Body, "state"));
        Assert.Equal("not-completed", Str((await Post(c, "/api/taste/coupon", new { email = address, marketingConsent = true })).Body, "state"));
        await Code(c, "2741");

        // the form; no address, a bad address, or no consent: refused, and no coupon is made
        var form = (await Post(c, "/api/taste/coupon/status")).Body;
        Assert.Equal("form", Str(form, "state"));
        Assert.False(form.TryGetProperty("coupon", out _));
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(c, "/api/taste/coupon", new { })).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(c, "/api/taste/coupon", new { email = "not-an-address", marketingConsent = true })).Status);
        var noConsent = await Post(c, "/api/taste/coupon", new { email = address, marketingConsent = false });
        Assert.Equal(HttpStatusCode.BadRequest, noConsent.Status);
        Assert.Equal("no-consent", Str(noConsent.Body, "code"));
        Assert.False(await Db(db => db.Coupons.AnyAsync(k => k.DemoSessionId == id)));

        // the provider fails: no code on the screen, the same coupon kept for "נסה שוב"
        mail.FailNext = 2;
        var failed = (await Post(c, "/api/taste/coupon", new { email = address, marketingConsent = true })).Body;
        Assert.Equal("failed", Str(failed, "state"));
        Assert.False(failed.TryGetProperty("coupon", out _));
        var coupon = await Db(db => db.Coupons.AsNoTracking().SingleAsync(k => k.DemoSessionId == id));
        Assert.Equal(address, coupon.Email);
        Assert.Equal("failed", coupon.EmailStatus);
        Assert.DoesNotContain(coupon.Code, failed.GetRawText());
        Assert.Equal("failed", Str((await Post(c, "/api/taste/coupon/status")).Body, "state"));

        // the consent is on the server: on the session and on the mailing list
        var session = await Db(db => db.DemoSessions.AsNoTracking().FirstAsync(x => x.Id == id));
        Assert.Equal(address, session.ConsentEmail);
        Assert.NotNull(session.MarketingConsentAt);
        var consent = await Db(db => db.MarketingConsents.AsNoTracking().FirstAsync(x => x.Email == address));
        Assert.Equal(ConsentStatus.Active, consent.Status);
        Assert.Equal(DemoCouponService.ConsentSource, consent.Source);

        // the retry: the same coupon to the same address, and now its code
        var sent = (await Post(c, "/api/taste/coupon", new { retry = true })).Body;
        Assert.Equal("sent", Str(sent, "state"));
        Assert.Equal(coupon.Code, sent.GetProperty("coupon").GetProperty("code").GetString());
        Assert.Equal(10m, sent.GetProperty("coupon").GetProperty("discountPercent").GetDecimal());
        var email = Assert.Single(mail.Sent, m => m.To == address);
        Assert.Contains(coupon.Code, email.Text);
        Assert.Equal(ChallengeService.TasteSubject, email.Subject);
        Assert.NotNull(email.UnsubscribeUrl);

        // a refresh, a second tab, or sending again: the same coupon, never a second one, never a second email
        var again = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Post(c, "/api/taste/coupon", new { email = address, marketingConsent = true })));
        Assert.All(again, r => Assert.Equal(coupon.Code, r.Body.GetProperty("coupon").GetProperty("code").GetString()));
        Assert.Equal(coupon.Code, (await Post(c, "/api/taste/coupon/status")).Body.GetProperty("coupon").GetProperty("code").GetString());
        Assert.Equal(1, await Db(db => db.Coupons.CountAsync(k => k.DemoSessionId == id)));
        Assert.Single(mail.Sent, m => m.To == address);
        var stored = await Db(db => db.Coupons.AsNoTracking().SingleAsync(k => k.DemoSessionId == id));
        Assert.Equal(1, stored.MaxRedemptions);
        Assert.InRange((stored.EndsAt!.Value - stored.StartsAt!.Value).TotalDays, 7.9, 8.1);

        // another finished taste cannot take the same address
        var (other, _) = BrowserWithMail();
        await StateOf(await other.PostAsJsonAsync("/api/taste/start", new { }));
        await Code(other, "2741");
        Assert.Equal(HttpStatusCode.Conflict, (await Post(other, "/api/taste/coupon", new { email = address, marketingConsent = true })).Status);

        // without the session's cookie there is nothing to issue
        var stranger = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        Assert.Equal("no-session", Str((await Post(stranger, "/api/taste/coupon/status")).Body, "state"));
    }

    // ------------------------------------------------------------------ stage F: the admin tab

    private async Task<JsonElement> AdminTasteAsync(HttpClient admin)
    {
        var r = await admin.GetAsync("/api/admin/taste");
        r.EnsureSuccessStatusCode();
        return await r.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    [Fact]
    public async Task The_admin_tab_counts_the_funnel_and_never_counts_a_test_payment_as_a_purchase()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/admin/taste")).StatusCode);

        var admin = factory.CreateClient();
        (await admin.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        admin.DefaultRequestHeaders.Add(PortalX.Server.Admin.AdminAuth.CsrfHeader, "1");
        var before = (await AdminTasteAsync(admin)).GetProperty("funnel");

        var quitter = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var set = (await quitter.PostAsJsonAsync("/api/taste/start", new { device = "tablet" })).Headers.GetValues("Set-Cookie").First();
        var token = set[(DemoService.Cookie.Length + 1)..set.IndexOf(';')];

        var solver = Browser();
        await StateOf(await solver.PostAsJsonAsync("/api/taste/start", new { }));
        await Code(solver, "2741");
        var order = await TestPurchase.CreateOrderAsync(solver, factory.Services);
        (await TestPurchase.PayAsync(solver, order)).EnsureSuccessStatusCode();

        var after = await AdminTasteAsync(admin);
        var f = after.GetProperty("funnel");
        int Delta(string k) => f.GetProperty(k).GetInt32() - before.GetProperty(k).GetInt32();
        Assert.Equal(2, Delta("started"));
        Assert.Equal(1, Delta("completed"));
        Assert.Equal(1, Delta("checkoutStarted"));
        // the sandbox is a test payment: shown apart, never a purchase or revenue
        Assert.Equal(1, Delta("testPurchases"));
        Assert.Equal(0, Delta("purchased"));
        Assert.Equal(before.GetProperty("revenue").GetDecimal(), f.GetProperty("revenue").GetDecimal());
        // nothing that could open a session leaves the server
        Assert.DoesNotContain(token, after.GetRawText());
        Assert.DoesNotContain(RoomServiceHash(token), after.GetRawText());
    }

    // ------------------------------------------------------------------ stage G: the edges

    [Fact]
    public async Task A_session_older_than_a_week_is_gone_and_entering_again_starts_a_new_one()
    {
        var since = DateTime.UtcNow.AddSeconds(-1);
        var c = Browser();
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var old = await LatestSessionAsync(since);
        await Db(db => db.DemoSessions.Where(s => s.Id == old)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.CreatedAt, s => s.CreatedAt - DemoService.Lifetime - TimeSpan.FromMinutes(1))));

        Assert.Null((await c.GetFromJsonAsync<StateReply>("/api/taste/state", Json))!.State);
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsJsonAsync("/api/taste/code", new { code = "2741" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsJsonAsync("/api/taste/inspect", new { item = "key" })).StatusCode);

        var fresh = await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        Assert.Empty(fresh.Inspected);
        Assert.Equal(0, fresh.Attempts);
        Assert.NotEqual(old, await LatestSessionAsync(since));
        // the old session was not completed by the late guess
        Assert.Null(await Db(db => db.DemoSessions.Where(s => s.Id == old).Select(s => s.CompletedAt).FirstAsync()));
    }

    [Fact]
    public async Task Malformed_codes_devices_and_events_change_nothing()
    {
        var since = DateTime.UtcNow.AddSeconds(-1);
        var c = Browser();
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { device = "<script>" }));
        var id = await LatestSessionAsync(since);
        Assert.Equal("desktop", await Db(db => db.DemoSessions.Where(s => s.Id == id).Select(s => s.Device).FirstAsync()));

        foreach (var bad in new[] { "", "abcd", "27411", "274", "２７４１", " 27 41 " })
        {
            var r = await Code(c, bad);
            Assert.False(r.Ok);
            Assert.False(r.State.Completed);
            Assert.Equal(0, r.State.Attempts);
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/taste/event", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/taste/event", new { type = "demo_completed" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/taste/event", new { type = "demo_purchase_completed" })).StatusCode);
        var s = await Db(db => db.DemoSessions.Where(x => x.Id == id).FirstAsync());
        Assert.Null(s.CompletedAt);
        Assert.Null(s.PurchasedAt);
        Assert.Equal(0, s.CodeAttempts);
    }

    [Fact]
    public async Task The_keypad_is_rate_limited_per_address()
    {
        await using var f = factory.WithWebHostBuilder(b =>
            b.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(new Dictionary<string, string?> { ["RateLimits:DemoCodePerMinute"] = "3" })));
        var c = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/taste/code", new { code = "1111" })).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await c.PostAsJsonAsync("/api/taste/code", new { code = "2741" })).StatusCode);
        // the rest of the room still answers
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/taste/inspect", new { item = "key" })).StatusCode);
    }

    private static string RoomServiceHash(string token) => PortalX.Server.Game.RoomService.Hash(token);
}
