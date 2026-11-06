using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Mail;
using PortalX.Server.Payments;
using PortalX.Server.Referrals;

namespace PortalX.Tests;

/// <summary>A real (non-test) payment provider for tests: orders are live, notifications are applied directly.</summary>
public sealed class FakeLiveProvider : IPaymentProvider
{
    public string Name => "fake-live";
    public bool IsTest => false;
    public string NewSessionId() => "live_" + Guid.NewGuid().ToString("N");
    public Task<CheckoutSession> CreateCheckoutAsync(Order order) =>
        Task.FromResult(new CheckoutSession(order.ProviderSessionId!, "https://pay.test/" + order.ProviderSessionId));
    public PaymentNotification ParseWebhook(string body, IHeaderDictionary headers) => throw new InvalidWebhookException("not used");
}

/// <summary>Personal links: creation, mailing, same-visit attribution, counting, the admin tab and the mailing list (affiliate spec 14).</summary>
[Collection(DatabaseCollection.Name)]
public class ReferralTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const string Site = "https://portalx.test";
    private readonly HubIntegrationTests.Factory _factory;

    public ReferralTests(HubIntegrationTests.Factory factory) => _factory = factory;

    /// <summary>The site with a fake mail sender and, unless <paramref name="sandbox"/>, a live (non-test) payment provider.</summary>
    private (WebApplicationFactory<Program> F, FakeEmailSender Mail, FakeLiveProvider Live) Site_(bool sandbox = false)
    {
        var mail = new FakeEmailSender();
        var live = new FakeLiveProvider();
        var f = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PORTALX_SITE_URL"] = Site,
                ["RateLimits:ReferralPer10Minutes"] = "100000",
                ["RateLimits:ReferralResendPer10Minutes"] = "100000",
                ["RateLimits:ReferralVisitsPerMinute"] = "100000",
                ["RateLimits:FreeGamesPerHour"] = "100000",
            }));
            b.ConfigureTestServices(s =>
            {
                s.AddSingleton<IEmailSender>(mail);
                if (!sandbox) s.AddSingleton(new PaymentGateway(live));
            });
        });
        return (f, mail, live);
    }

    private static HttpClient Browser(WebApplicationFactory<Program> f) => f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static async Task<JsonElement> Body(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>(Json);

    private static string Unique(string name) => $"{name}.{Guid.NewGuid():N}"[..22] + "@Example.org";

    private static Task<HttpResponseMessage> Create(HttpClient http, string? email, string? first = "דנה", string? last = "כהן", bool consent = true, bool terms = true) =>
        http.PostAsJsonAsync("/api/referrals", new { firstName = first, lastName = last, email, marketingConsent = consent, acceptTerms = terms });

    private static async Task<string> NewLinkAsync(HttpClient http, string email)
    {
        var r = await Body(await Create(http, email));
        Assert.True(r.GetProperty("ok").GetBoolean(), r.ToString());
        return r.GetProperty("token").GetString()!;
    }

    private static async Task<T> DbAsync<T>(WebApplicationFactory<Program> f, Func<PortalDbContext, Task<T>> q)
    {
        using var scope = f.Services.CreateScope();
        return await q(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    /// <summary>Opens "/r/{token}" in this browser (its cookies are kept by the client).</summary>
    private static async Task OpenLinkAsync(HttpClient browser, string token)
    {
        var r = await browser.GetAsync("/r/" + token);
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        Assert.Equal("/", r.Headers.Location!.OriginalString);
    }

    private static async Task<TestPurchase.Purchase> OrderAsync(HttpClient browser, WebApplicationFactory<Program> f, string? email = null) =>
        await TestPurchase.CreateOrderAsync(browser, f.Services, email: email);

    private static async Task<string> NotifyAsync(WebApplicationFactory<Program> f, FakeLiveProvider live, TestPurchase.Purchase p, PaymentEventType type,
        decimal? amount = null, string? eventId = null)
    {
        using var scope = f.Services.CreateScope();
        var purchases = scope.ServiceProvider.GetRequiredService<PurchaseService>();
        return await purchases.ApplyAsync(live, new PaymentNotification(eventId ?? "evt_" + Guid.NewGuid().ToString("N"), type, p.Session, p.OrderId,
            type == PaymentEventType.Succeeded ? "tx_" + Guid.NewGuid().ToString("N")[..12] : null, amount ?? TestPurchase.Price, "ILS", false));
    }

    private static async Task<HttpClient> AdminAsync(WebApplicationFactory<Program> f)
    {
        var admin = f.CreateClient();
        (await admin.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        admin.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return admin;
    }

    private static async Task<JsonElement> AdminRowAsync(HttpClient admin, string email, string extra = "")
    {
        var list = await Body(await admin.GetAsync($"/api/admin/referrals?search={Uri.EscapeDataString(email.ToLowerInvariant())}{extra}"));
        return Assert.Single(list.GetProperty("rows").EnumerateArray());
    }

    private static decimal Net(JsonElement row) => row.GetProperty("money").EnumerateArray().Sum(m => m.GetProperty("net").GetDecimal());
    private static decimal Gross(JsonElement row) => row.GetProperty("money").EnumerateArray().Sum(m => m.GetProperty("gross").GetDecimal());

    // ------------------------------------------------------------------ creating a link (1–8)

    [Fact]
    public async Task A_new_link_is_shown_at_once_stored_with_its_consent_and_mailed_through_the_site_sender()
    {
        var (f, mail, _) = Site_();
        using var __ = f;
        var http = f.CreateClient();
        var email = Unique("new");
        var r = await Body(await Create(http, "  " + email.ToUpperInvariant() + " "));
        Assert.True(r.GetProperty("ok").GetBoolean(), r.ToString());
        Assert.Equal("created", r.GetProperty("code").GetString());
        var token = r.GetProperty("token").GetString()!;
        Assert.Equal(22, token.Length);
        Assert.Equal($"{Site}/r/{token}", r.GetProperty("url").GetString());
        Assert.Equal("דנה", r.GetProperty("firstName").GetString());
        // "sent" only with the provider's confirmation
        Assert.Equal("sent", r.GetProperty("emailStatus").GetString());
        Assert.Equal(ReferralService.SentMessage, r.GetProperty("emailMessage").GetString());
        // nothing personal in the link
        Assert.DoesNotContain(email.Split('@')[0], token, StringComparison.OrdinalIgnoreCase);

        var m = Assert.Single(mail.Sent);
        Assert.Equal(email.ToLowerInvariant(), m.To);
        Assert.Equal("הקישור האישי שלך ל-PORTAL X מוכן!", m.Subject);
        Assert.Contains("dir=\"rtl\"", m.Html);
        Assert.Contains("שלום דנה", m.Html);
        Assert.Contains($"{Site}/r/{token}", m.Html);
        Assert.Contains($"{Site}/r/{token}", m.Text);
        Assert.NotNull(m.UnsubscribeUrl);

        var link = await DbAsync(f, db => db.ReferralLinks.AsNoTracking().FirstAsync(l => l.Token == token));
        Assert.Equal(email.ToLowerInvariant(), link.Email);
        Assert.Equal(("דנה", "כהן"), (link.FirstName, link.LastName));
        Assert.True(link.MarketingConsent);
        Assert.Equal(ReferralService.ConsentVersion, link.ConsentVersion);
        Assert.Equal("sent", link.LastEmailStatus);
        Assert.False(string.IsNullOrEmpty(link.LastEmailMessageId));
        Assert.Equal(CommissionMode.None, link.CommissionMode);
        Assert.False(link.CommissionEnabled);
        var consent = await DbAsync(f, db => db.MarketingConsents.AsNoTracking().FirstAsync(c => c.Email == link.Email));
        Assert.Equal(ConsentStatus.Active, consent.Status);
        Assert.Equal(ReferralService.Source, consent.Source);
        Assert.Equal(1, await DbAsync(f, db => db.MarketingConsentEvents.CountAsync(e => e.Email == link.Email && e.Action == "granted")));
    }

    [Theory]
    [InlineData("", "כהן", "ok", true, true, "bad-name")]
    [InlineData("דנה", "  ", "ok", true, true, "bad-name")]
    [InlineData("דנה<script>", "כהן", "ok", true, true, "bad-name")]
    [InlineData("דנה", "כהן", "not-an-email", true, true, "bad-email")]
    [InlineData("דנה", "כהן", "ok", false, true, "consent-required")]
    [InlineData("דנה", "כהן", "ok", true, false, "terms-required")]
    public async Task Missing_or_invalid_details_are_refused_and_nothing_is_stored(string first, string last, string email, bool consent, bool terms, string code)
    {
        var (f, mail, _) = Site_();
        using var __ = f;
        var address = email == "ok" ? Unique("bad") : email;
        var r = await Create(f.CreateClient(), address, first, last, consent, terms);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(code, (await Body(r)).GetProperty("code").GetString());
        Assert.Empty(mail.Sent);
        if (email == "ok") Assert.False(await DbAsync(f, db => db.ReferralLinks.AnyAsync(l => l.Email == address.ToLowerInvariant())));
    }

    [Fact]
    public async Task The_same_address_always_gets_its_existing_link_and_never_a_second_one()
    {
        var (f, mail, _) = Site_();
        using var __ = f;
        var http = f.CreateClient();
        var email = Unique("twice");
        var token = await NewLinkAsync(http, email);
        var again = await Body(await Create(http, email.ToUpperInvariant(), "אחר", "שם"));
        Assert.Equal("existing", again.GetProperty("code").GetString());
        Assert.True(again.GetProperty("existing").GetBoolean());
        Assert.Equal(token, again.GetProperty("token").GetString());
        // nothing about the owner is revealed beyond the link
        Assert.Equal("אחר", again.GetProperty("firstName").GetString());
        Assert.Single(mail.Sent);
        Assert.Equal(1, await DbAsync(f, db => db.ReferralLinks.CountAsync(l => l.Email == email.ToLowerInvariant())));
        var link = await DbAsync(f, db => db.ReferralLinks.AsNoTracking().FirstAsync(l => l.Token == token));
        Assert.Equal("דנה", link.FirstName);
    }

    [Fact]
    public async Task Parallel_submissions_of_one_address_create_exactly_one_link()
    {
        var (f, _, _) = Site_();
        using var __ = f;
        var email = Unique("race");
        var replies = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Create(f.CreateClient(), email)));
        var tokens = new HashSet<string>();
        foreach (var r in replies)
        {
            var b = await Body(r);
            Assert.True(b.GetProperty("ok").GetBoolean(), b.ToString());
            tokens.Add(b.GetProperty("token").GetString()!);
        }
        Assert.Single(tokens);
        Assert.Equal(1, await DbAsync(f, db => db.ReferralLinks.CountAsync(l => l.Email == email.ToLowerInvariant())));
    }

    [Fact]
    public async Task A_failed_email_still_shows_the_link_and_can_be_retried_but_not_repeated_right_after_success()
    {
        var (f, mail, _) = Site_();
        using var __ = f;
        var http = f.CreateClient();
        mail.FailNext = 2;
        mail.Transient = false;
        var email = Unique("fail");
        var r = await Body(await Create(http, email));
        Assert.True(r.GetProperty("ok").GetBoolean());
        var token = r.GetProperty("token").GetString()!;
        Assert.Equal("failed", r.GetProperty("emailStatus").GetString());
        Assert.Equal(ReferralService.FailedMessage, r.GetProperty("emailMessage").GetString());
        Assert.Empty(mail.Sent);

        mail.FailNext = 0;
        var retry = await Body(await http.PostAsJsonAsync("/api/referrals/resend", new { token }));
        Assert.Equal("sent", retry.GetProperty("emailStatus").GetString());
        Assert.Equal(token, retry.GetProperty("token").GetString());
        Assert.Single(mail.Sent);

        // right after a send that went out: refused, nothing mailed
        var again = await http.PostAsJsonAsync("/api/referrals/resend", new { token });
        Assert.Equal(HttpStatusCode.TooManyRequests, again.StatusCode);
        Assert.Single(mail.Sent);
        // an unknown token says nothing
        Assert.Equal(HttpStatusCode.NotFound, (await http.PostAsJsonAsync("/api/referrals/resend", new { token = "AAAAAAAAAAAAAAAAAAAAAA" })).StatusCode);
    }

    // ------------------------------------------------------------------ attribution (9–13, 26)

    [Fact]
    public async Task A_purchase_started_in_the_visit_of_a_link_is_attributed_even_after_the_payment_provider_returns()
    {
        var (f, _, live) = Site_();
        using var __ = f;
        var token = await NewLinkAsync(f.CreateClient(), Unique("owner"));
        var linkId = await DbAsync(f, db => db.ReferralLinks.Where(l => l.Token == token).Select(l => l.Id).FirstAsync());

        var visitor = Browser(f);
        await OpenLinkAsync(visitor, token);
        var p = await OrderAsync(visitor, f, Unique("buyer"));
        var order = await DbAsync(f, db => db.Orders.AsNoTracking().FirstAsync(o => o.Id == p.OrderId));
        Assert.Equal(linkId, order.ReferralLinkId);
        Assert.NotNull(order.ReferralAttributedAt);
        Assert.False(order.IsTest);

        // the provider calls the server later, from elsewhere (no cookie): the attribution was already fixed on the order
        Assert.Equal("applied:paid", await NotifyAsync(f, live, p, PaymentEventType.Succeeded));
        order = await DbAsync(f, db => db.Orders.AsNoTracking().FirstAsync(o => o.Id == p.OrderId));
        Assert.Equal(linkId, order.ReferralLinkId);
        Assert.Null(order.ReferralExclusion);
        Assert.True(ReferralAdmin.Counts(order));
    }

    [Fact]
    public async Task A_purchase_without_a_link_visit_or_in_a_new_visit_is_not_attributed()
    {
        var (f, _, _) = Site_();
        using var __ = f;
        var token = await NewLinkAsync(f.CreateClient(), Unique("owner2"));
        var plain = await OrderAsync(Browser(f), f);
        Assert.Null(await DbAsync(f, db => db.Orders.Where(o => o.Id == plain.OrderId).Select(o => o.ReferralLinkId).FirstAsync()));

        // a visit that opened the link, then the browser session ended: a new browser has no attribution
        var first = Browser(f);
        await OpenLinkAsync(first, token);
        var later = await OrderAsync(Browser(f), f);
        Assert.Null(await DbAsync(f, db => db.Orders.Where(o => o.Id == later.OrderId).Select(o => o.ReferralLinkId).FirstAsync()));

        // a visit older than its lifetime counts no more, even if the browser kept its session cookie
        await DbAsync(f, db => db.ReferralVisits.ExecuteUpdateAsync(s => s.SetProperty(v => v.LastClickAt, v => v.LastClickAt.AddHours(-30))));
        var stale = await OrderAsync(first, f);
        Assert.Null(await DbAsync(f, db => db.Orders.Where(o => o.Id == stale.OrderId).Select(o => o.ReferralLinkId).FirstAsync()));
    }

    [Fact]
    public async Task With_two_links_in_one_visit_the_last_one_opened_gets_the_purchase()
    {
        var (f, _, _) = Site_();
        using var __ = f;
        var a = await NewLinkAsync(f.CreateClient(), Unique("first"));
        var b = await NewLinkAsync(f.CreateClient(), Unique("second"));
        var visitor = Browser(f);
        await OpenLinkAsync(visitor, a);
        await OpenLinkAsync(visitor, b);
        var p = await OrderAsync(visitor, f);
        var bId = await DbAsync(f, db => db.ReferralLinks.Where(l => l.Token == b).Select(l => l.Id).FirstAsync());
        Assert.Equal(bId, await DbAsync(f, db => db.Orders.Where(o => o.Id == p.OrderId).Select(o => o.ReferralLinkId).FirstAsync()));
        // an unknown token neither breaks the site nor changes the visit
        var bad = await visitor.GetAsync("/r/not-a-real-token-123");
        Assert.Equal(HttpStatusCode.Redirect, bad.StatusCode);
        var q = await OrderAsync(visitor, f);
        Assert.Equal(bId, await DbAsync(f, db => db.Orders.Where(o => o.Id == q.OrderId).Select(o => o.ReferralLinkId).FirstAsync()));
    }

    [Fact]
    public async Task A_disabled_link_gets_no_new_attribution_and_is_not_shown_again()
    {
        var (f, _, _) = Site_();
        using var __ = f;
        var email = Unique("off");
        var token = await NewLinkAsync(f.CreateClient(), email);
        var visitor = Browser(f);
        await OpenLinkAsync(visitor, token);
        var admin = await AdminAsync(f);
        var id = (await AdminRowAsync(admin, email)).GetProperty("id").GetGuid();
        (await admin.PostAsJsonAsync($"/api/admin/referrals/{id}/status", new { active = false })).EnsureSuccessStatusCode();

        var p = await OrderAsync(visitor, f);
        Assert.Null(await DbAsync(f, db => db.Orders.Where(o => o.Id == p.OrderId).Select(o => o.ReferralLinkId).FirstAsync()));
        var fresh = Browser(f);
        var open = await fresh.GetAsync("/r/" + token);
        Assert.Equal(HttpStatusCode.Redirect, open.StatusCode);
        Assert.False(open.Headers.Contains("Set-Cookie"));
        Assert.Equal("link-disabled", (await Body(await Create(f.CreateClient(), email))).GetProperty("code").GetString());
        Assert.Equal("disabled", (await AdminRowAsync(admin, email)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task The_visit_cookie_is_a_session_cookie_holding_only_a_random_visit_id()
    {
        var (f, _, _) = Site_();
        using var __ = f;
        var email = Unique("cookie");
        var token = await NewLinkAsync(f.CreateClient(), email);
        var r = await Browser(f).GetAsync("/r/" + token);
        var cookie = Assert.Single(r.Headers.GetValues("Set-Cookie"), c => c.StartsWith(ReferralService.VisitCookie + "="));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("expires", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("max-age", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(token, cookie);
        Assert.DoesNotContain(email.Split('@')[0], cookie, StringComparison.OrdinalIgnoreCase);
    }

    // ------------------------------------------------------------------ counting (14–20)

    [Fact]
    public async Task The_owners_own_purchase_stays_a_sale_but_never_counts_for_the_link()
    {
        var (f, _, live) = Site_();
        using var __ = f;
        var email = Unique("self");
        var token = await NewLinkAsync(f.CreateClient(), email);
        var owner = Browser(f);
        await OpenLinkAsync(owner, token);
        var p = await OrderAsync(owner, f, "  " + email.ToUpperInvariant());
        Assert.Equal("applied:paid", await NotifyAsync(f, live, p, PaymentEventType.Succeeded));
        var order = await DbAsync(f, db => db.Orders.AsNoTracking().FirstAsync(o => o.Id == p.OrderId));
        Assert.Equal(OrderStatus.Paid, order.Status);
        Assert.Equal("self-purchase", order.ReferralExclusion);
        Assert.False(ReferralAdmin.Counts(order));

        var admin = await AdminAsync(f);
        var row = await AdminRowAsync(admin, email);
        Assert.Equal(0, row.GetProperty("purchases").GetInt32());
        var d = await Body(await admin.GetAsync($"/api/admin/referrals/{row.GetProperty("id").GetGuid()}"));
        var o = Assert.Single(d.GetProperty("orders").EnumerateArray());
        Assert.False(o.GetProperty("counted").GetBoolean());
        Assert.Equal("self-purchase", o.GetProperty("excluded").GetString());
    }

    [Fact]
    public async Task Only_confirmed_payments_count_once_and_refunds_reduce_the_net_revenue()
    {
        var (f, _, live) = Site_();
        using var __ = f;
        var email = Unique("money");
        var token = await NewLinkAsync(f.CreateClient(), email);
        var visitor = Browser(f);
        await OpenLinkAsync(visitor, token);

        var pending = await OrderAsync(visitor, f);
        var failed = await OrderAsync(visitor, f);
        var cancelled = await OrderAsync(visitor, f);
        var paid = await OrderAsync(visitor, f);
        var full = await OrderAsync(visitor, f);
        var partial = await OrderAsync(visitor, f);
        Assert.Equal("applied:failed", await NotifyAsync(f, live, failed, PaymentEventType.Failed));
        Assert.Equal("applied:cancelled", await NotifyAsync(f, live, cancelled, PaymentEventType.Cancelled));
        // the same notification twice, and a second success for the same order: counted once
        Assert.Equal("applied:paid", await NotifyAsync(f, live, paid, PaymentEventType.Succeeded, eventId: "dup-" + paid.OrderId));
        Assert.Equal("duplicate", await NotifyAsync(f, live, paid, PaymentEventType.Succeeded, eventId: "dup-" + paid.OrderId));
        Assert.StartsWith("ignored", await NotifyAsync(f, live, paid, PaymentEventType.Succeeded));
        Assert.Equal("applied:paid", await NotifyAsync(f, live, full, PaymentEventType.Succeeded));
        Assert.Equal("applied:refunded", await NotifyAsync(f, live, full, PaymentEventType.Refunded, TestPurchase.Price));
        Assert.Equal("applied:paid", await NotifyAsync(f, live, partial, PaymentEventType.Succeeded));
        Assert.Equal("applied:refunded", await NotifyAsync(f, live, partial, PaymentEventType.Refunded, 20m));

        var admin = await AdminAsync(f);
        var row = await AdminRowAsync(admin, email);
        // paid, fully refunded and partly refunded: three paid purchases; pending/failed/cancelled are not revenue
        Assert.Equal(3, row.GetProperty("purchases").GetInt32());
        Assert.Equal(2, row.GetProperty("refunded").GetInt32());
        Assert.Equal(3 * TestPurchase.Price, Gross(row));
        Assert.Equal(TestPurchase.Price + (TestPurchase.Price - 20m), Net(row));
        var m = Assert.Single(row.GetProperty("money").EnumerateArray());
        Assert.Equal("ILS", m.GetProperty("currency").GetString());
        Assert.Equal(TestPurchase.Price + 20m, m.GetProperty("refunds").GetDecimal());
        var game = Assert.Single(row.GetProperty("games").EnumerateArray());
        Assert.Equal(TestPurchase.ProductId, game.GetProperty("productId").GetString());
        Assert.Equal(3, game.GetProperty("purchases").GetInt32());

        var d = await Body(await admin.GetAsync($"/api/admin/referrals/{row.GetProperty("id").GetGuid()}"));
        var orders = d.GetProperty("orders").EnumerateArray().ToList();
        Assert.Equal(6, orders.Count);
        Assert.Equal(3, orders.Count(o => o.GetProperty("counted").GetBoolean()));
        Assert.Equal("not-paid", orders.First(o => o.GetProperty("id").GetGuid() == pending.OrderId).GetProperty("excluded").GetString());
        Assert.Equal(20m, orders.First(o => o.GetProperty("id").GetGuid() == partial.OrderId).GetProperty("refunded").GetDecimal());
    }

    [Fact]
    public async Task Test_payments_are_attributed_but_never_counted_as_revenue()
    {
        var (f, _, _) = Site_(sandbox: true);
        using var __ = f;
        var email = Unique("sandbox");
        var token = await NewLinkAsync(f.CreateClient(), email);
        var visitor = Browser(f);
        await OpenLinkAsync(visitor, token);
        var p = await OrderAsync(visitor, f);
        (await TestPurchase.PayAsync(visitor, p)).EnsureSuccessStatusCode();
        var order = await DbAsync(f, db => db.Orders.AsNoTracking().FirstAsync(o => o.Id == p.OrderId));
        Assert.True(order.IsTest);
        Assert.Equal(OrderStatus.Paid, order.Status);
        Assert.NotNull(order.ReferralLinkId);
        var admin = await AdminAsync(f);
        var row = await AdminRowAsync(admin, email);
        Assert.Equal(0, row.GetProperty("purchases").GetInt32());
        Assert.Equal(0m, Gross(row));
        var d = await Body(await admin.GetAsync($"/api/admin/referrals/{row.GetProperty("id").GetGuid()}"));
        Assert.Equal("test", Assert.Single(d.GetProperty("orders").EnumerateArray()).GetProperty("excluded").GetString());
    }

    // ------------------------------------------------------------------ the admin tab (21–25)

    [Fact]
    public async Task Only_the_admin_can_read_the_links_and_their_numbers()
    {
        var (f, _, _) = Site_();
        using var __ = f;
        var anon = f.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/admin/referrals")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/admin/referrals.csv")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync($"/api/admin/referrals/{Guid.NewGuid()}")).StatusCode);
        // a logged-in admin still needs the admin header to change anything
        var admin = f.CreateClient();
        (await admin.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync($"/api/admin/referrals/{Guid.NewGuid()}/status", new { active = false })).StatusCode);
    }

    [Fact]
    public async Task Filters_and_summary_use_the_real_numbers_and_the_csv_is_safe_hebrew()
    {
        var (f, _, live) = Site_();
        using var __ = f;
        var tag = Guid.NewGuid().ToString("N")[..8];
        var withSale = $"=sum{tag}@example.org";
        var without = $"quiet{tag}@example.org";
        var t1 = await NewLinkAsync(f.CreateClient(), withSale);
        await NewLinkAsync(f.CreateClient(), without);
        var visitor = Browser(f);
        await OpenLinkAsync(visitor, t1);
        var p = await OrderAsync(visitor, f);
        await NotifyAsync(f, live, p, PaymentEventType.Succeeded);

        var admin = await AdminAsync(f);
        var all = await Body(await admin.GetAsync($"/api/admin/referrals?search={tag}"));
        Assert.Equal(2, all.GetProperty("rows").GetArrayLength());
        Assert.Equal(2, all.GetProperty("summary").GetProperty("links").GetInt32());
        Assert.Equal(1, all.GetProperty("summary").GetProperty("purchases").GetInt32());
        Assert.Equal(TestPurchase.Price, all.GetProperty("summary").GetProperty("money").EnumerateArray().Sum(m => m.GetProperty("net").GetDecimal()));

        Assert.Single((await Body(await admin.GetAsync($"/api/admin/referrals?search={tag}&minPurchases=1"))).GetProperty("rows").EnumerateArray());
        Assert.Single((await Body(await admin.GetAsync($"/api/admin/referrals?search={tag}&minNet=10"))).GetProperty("rows").EnumerateArray());
        Assert.Single((await Body(await admin.GetAsync($"/api/admin/referrals?search={tag}&game={TestPurchase.ProductId}"))).GetProperty("rows").EnumerateArray());
        Assert.Empty((await Body(await admin.GetAsync($"/api/admin/referrals?search={tag}&game=hanukkah-oil"))).GetProperty("rows").EnumerateArray());
        Assert.Equal(2, (await Body(await admin.GetAsync($"/api/admin/referrals?search={tag}&status=active"))).GetProperty("rows").GetArrayLength());
        // the purchase range limits what is counted, not which links are shown
        var old = await Body(await admin.GetAsync($"/api/admin/referrals?search={tag}&paidTo=2020-01-01"));
        Assert.Equal(0, old.GetProperty("summary").GetProperty("purchases").GetInt32());
        Assert.Empty((await Body(await admin.GetAsync($"/api/admin/referrals?search={tag}&createdTo=2020-01-01"))).GetProperty("rows").EnumerateArray());

        var csv = await admin.GetAsync($"/api/admin/referrals.csv?search={tag}");
        Assert.Equal(HttpStatusCode.OK, csv.StatusCode);
        var bytes = await csv.Content.ReadAsByteArrayAsync();
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, bytes[..3]);
        var text = Encoding.UTF8.GetString(bytes);
        Assert.Contains("שם פרטי,שם משפחה,מייל,קישור אישי", text);
        // a value that would run as a spreadsheet formula is neutralised
        Assert.Contains("'=sum" + tag, text);
        Assert.DoesNotContain("," + withSale, text);
        Assert.Contains("50 ILS", text);
    }

    // ------------------------------------------------------------------ the mailing list (27–28)

    [Fact]
    public async Task Link_makers_join_the_mailing_list_once_and_a_revoked_consent_is_not_an_active_subscriber()
    {
        var (f, _, _) = Site_();
        using var __ = f;
        var email = Unique("list");
        await NewLinkAsync(f.CreateClient(), email);
        await NewLinkAsync(f.CreateClient(), email);
        var admin = await AdminAsync(f);
        var list = await Body(await admin.GetAsync($"/api/admin/mailing?search={Uri.EscapeDataString(email.ToLowerInvariant())}"));
        var row = Assert.Single(list.GetProperty("rows").EnumerateArray());
        Assert.Equal("active", row.GetProperty("consent").GetString());
        Assert.Contains("referral", row.GetProperty("sources").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal("דנה", row.GetProperty("firstName").GetString());
        Assert.StartsWith($"{Site}/r/", row.GetProperty("referralUrl").GetString());
        Assert.Equal(ReferralService.Source, row.GetProperty("consentSource").GetString());
        Assert.Single((await Body(await admin.GetAsync($"/api/admin/mailing?search={Uri.EscapeDataString(email.ToLowerInvariant())}&source=referral"))).GetProperty("rows").EnumerateArray());
        Assert.Empty((await Body(await admin.GetAsync($"/api/admin/mailing?search={Uri.EscapeDataString(email.ToLowerInvariant())}&source=results"))).GetProperty("rows").EnumerateArray());

        // the owner unsubscribes through the email's link: revoked, kept in the history, no longer an active subscriber
        string unsubToken;
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
            var c = await db.MarketingConsents.FirstAsync(x => x.Email == email.ToLowerInvariant());
            unsubToken = await scope.ServiceProvider.GetRequiredService<UnsubscribeLinks>().TokenAsync(c);
        }
        (await f.CreateClient().PostAsJsonAsync("/api/unsubscribe", new { token = unsubToken })).EnsureSuccessStatusCode();
        row = Assert.Single((await Body(await admin.GetAsync($"/api/admin/mailing?search={Uri.EscapeDataString(email.ToLowerInvariant())}&consent=revoked"))).GetProperty("rows").EnumerateArray());
        Assert.Equal("revoked", row.GetProperty("consent").GetString());
        Assert.Empty((await Body(await admin.GetAsync($"/api/admin/mailing?search={Uri.EscapeDataString(email.ToLowerInvariant())}&consent=active"))).GetProperty("rows").EnumerateArray());
        var history = await DbAsync(f, db => db.MarketingConsentEvents.AsNoTracking().Where(e => e.Email == email.ToLowerInvariant()).OrderBy(e => e.Id).Select(e => e.Action).ToListAsync());
        Assert.Equal(["granted", "revoked"], history);

        // a new explicit tick in the form makes it active again, and the history keeps all three
        await NewLinkAsync(f.CreateClient(), email);
        Assert.Equal("active", Assert.Single((await Body(await admin.GetAsync($"/api/admin/mailing?search={Uri.EscapeDataString(email.ToLowerInvariant())}"))).GetProperty("rows").EnumerateArray()).GetProperty("consent").GetString());
        Assert.Equal(3, await DbAsync(f, db => db.MarketingConsentEvents.CountAsync(e => e.Email == email.ToLowerInvariant())));
    }

    // ------------------------------------------------------------------ entries, free games and draw tickets per link

    private static async Task<Guid> LinkIdAsync(WebApplicationFactory<Program> f, string email) =>
        await DbAsync(f, db => db.ReferralLinks.Where(l => l.Email == email.ToLowerInvariant()).Select(l => l.Id).FirstAsync());

    /// <summary>Opens the free game in this browser and returns its room.</summary>
    private static async Task<Guid> FreeGameAsync(HttpClient browser, WebApplicationFactory<Program> f)
    {
        var r = await browser.PostAsync("/api/products/gate-of-secrets/free-game", null);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var code = (await Body(r)).GetProperty("code").GetString()!;
        return await DbAsync(f, db => db.Rooms.Where(x => x.Code == code).Select(x => x.Id).FirstAsync());
    }

    /// <summary>A player takes a seat and connects: the lobby, nothing more.</summary>
    private static async Task<Guid> SeatAsync(WebApplicationFactory<Program> f, Guid roomId)
    {
        using var scope = f.Services.CreateScope();
        var rooms = scope.ServiceProvider.GetRequiredService<PortalX.Server.Game.RoomService>();
        PlayerSession? created = null;
        await rooms.ExecuteAsync(roomId, null, "join", null, null, r =>
        {
            var o = rooms.Engine.AddPlayer(r, "שחקן" + Random.Shared.Next(100, 999), "explorer", "{}",
                PortalX.Server.Game.RoomService.Hash(Guid.NewGuid().ToString()), true, DateTime.UtcNow, out var p);
            created = p;
            return o;
        });
        var pid = created!.Id;
        await rooms.ExecuteAsync(roomId, pid, "connect", null, null, r => rooms.Engine.Reconnect(r, pid, "conn-" + pid, DateTime.UtcNow));
        return pid;
    }

    private static async Task<string> RunAsync(WebApplicationFactory<Program> f, Guid roomId, Guid playerId, string type,
        Func<PortalX.Server.Game.GameEngine, GameRoom, PortalX.Server.Game.ActionOutcome> action)
    {
        using var scope = f.Services.CreateScope();
        var rooms = scope.ServiceProvider.GetRequiredService<PortalX.Server.Game.RoomService>();
        return (await rooms.ExecuteAsync(roomId, playerId, type, null, null, r => action(rooms.Engine, r))).Outcome.Code;
    }

    private static Task<DateTime?> FirstStartAsync(WebApplicationFactory<Program> f, Guid roomId) =>
        DbAsync(f, db => db.Rooms.Where(r => r.Id == roomId).Select(r => r.FirstStartedAt).FirstAsync());

    [Fact]
    public async Task Entries_through_a_link_count_each_visit_once_and_never_a_refresh_of_the_same_visit()
    {
        var (f, _, _) = Site_();
        using var __ = f;
        var email = Unique("entries");
        var token = await NewLinkAsync(f.CreateClient(), email);
        var visitor = Browser(f);
        await OpenLinkAsync(visitor, token);
        await OpenLinkAsync(visitor, token);
        await OpenLinkAsync(visitor, token);
        await OpenLinkAsync(Browser(f), token);
        var admin = await AdminAsync(f);
        var row = await AdminRowAsync(admin, email);
        Assert.Equal(2, row.GetProperty("visits").GetInt32());
        // the short-lived visit records may be deleted later: the entries stay
        var id = row.GetProperty("id").GetGuid();
        await DbAsync(f, db => db.ReferralVisits.Where(v => v.ReferralLinkId == id).ExecuteDeleteAsync());
        Assert.Equal(2, (await AdminRowAsync(admin, email)).GetProperty("visits").GetInt32());
    }

    [Fact]
    public async Task A_free_game_counts_for_its_link_once_and_only_when_the_players_entered_the_game()
    {
        var (f, _, _) = Site_();
        using var __ = f;
        var email = Unique("freegame");
        var token = await NewLinkAsync(f.CreateClient(), email);
        var linkId = await LinkIdAsync(f, email);
        var visitor = Browser(f);
        await OpenLinkAsync(visitor, token);
        var admin = await AdminAsync(f);

        var room = await FreeGameAsync(visitor, f);
        Assert.Equal(linkId, await DbAsync(f, db => db.Rooms.Where(r => r.Id == room).Select(r => r.ReferralLinkId).FirstAsync()));
        // opening the game and waiting in the lobby is not playing it
        var host = await SeatAsync(f, room);
        Assert.Null(await FirstStartAsync(f, room));
        Assert.Equal(0, (await AdminRowAsync(admin, email)).GetProperty("freeGames").GetInt32());

        Assert.Equal("ok", await RunAsync(f, room, host, "start", (e, r) => e.StartGame(r, host, DateTime.UtcNow)));
        Assert.Equal(1, (await AdminRowAsync(admin, email)).GetProperty("freeGames").GetInt32());
        var first = await FirstStartAsync(f, room);
        Assert.NotNull(first);

        // a lost connection, a return to the same seat and a replay of the same game add nothing
        await RunAsync(f, room, host, "disconnect", (e, r) => e.Disconnect(r, host, "conn-" + host, DateTime.UtcNow));
        await RunAsync(f, room, host, "connect", (e, r) => e.Reconnect(r, host, "conn2-" + host, DateTime.UtcNow));
        await DbAsync(f, db => db.Rooms.Where(r => r.Id == room).ExecuteUpdateAsync(s => s.SetProperty(r => r.Phase, RoomPhase.Completed)));
        Assert.Equal("ok", await RunAsync(f, room, host, "replay", (e, r) => e.PlayAgain(r, host, DateTime.UtcNow)));
        Assert.Equal("ok", await RunAsync(f, room, host, "start", (e, r) => e.StartGame(r, host, DateTime.UtcNow)));
        Assert.Equal(first, await FirstStartAsync(f, room));
        Assert.Equal(1, (await AdminRowAsync(admin, email)).GetProperty("freeGames").GetInt32());

        // a second free game of the same visit is another game
        var second = await FreeGameAsync(visitor, f);
        var p2 = await SeatAsync(f, second);
        await RunAsync(f, second, p2, "start", (e, r) => e.StartGame(r, p2, DateTime.UtcNow));
        Assert.Equal(2, (await AdminRowAsync(admin, email)).GetProperty("freeGames").GetInt32());
        // a free game opened without a personal link belongs to no link
        var plain = await FreeGameAsync(Browser(f), f);
        Assert.Null(await DbAsync(f, db => db.Rooms.Where(r => r.Id == plain).Select(r => r.ReferralLinkId).FirstAsync()));
    }

    [Fact]
    public async Task Each_paid_purchase_through_a_link_is_one_ticket_and_a_repeated_notification_adds_none()
    {
        var (f, _, live) = Site_();
        using var __ = f;
        var email = Unique("tickets");
        var token = await NewLinkAsync(f.CreateClient(), email);
        var linkId = await LinkIdAsync(f, email);
        var buyer = Browser(f);
        await OpenLinkAsync(buyer, token);

        var one = await OrderAsync(buyer, f, "friend@example.org");
        Assert.Equal("applied:paid", await NotifyAsync(f, live, one, PaymentEventType.Succeeded, eventId: "evt_one_" + one.OrderId));
        // the same notification delivered again
        await NotifyAsync(f, live, one, PaymentEventType.Succeeded, eventId: "evt_one_" + one.OrderId);
        // the same buyer buys again: a second ticket
        var two = await OrderAsync(buyer, f, "friend@example.org");
        Assert.Equal("applied:paid", await NotifyAsync(f, live, two, PaymentEventType.Succeeded));
        // a failed payment and a free game never give a ticket
        var failed = await OrderAsync(buyer, f, "friend@example.org");
        await NotifyAsync(f, live, failed, PaymentEventType.Failed);
        await FreeGameAsync(buyer, f);

        var admin = await AdminAsync(f);
        var draw = await Body(await admin.GetAsync("/api/admin/draw"));
        var entry = Assert.Single(draw.GetProperty("entries").EnumerateArray(), e => e.GetProperty("linkId").GetGuid() == linkId);
        Assert.Equal(2, entry.GetProperty("tickets").GetInt32());
        var numbers = entry.GetProperty("ticketList").EnumerateArray().Select(t => t.GetProperty("orderNumber").GetInt64()).Order().ToList();
        var expected = (await DbAsync(f, db => db.Orders.Where(o => o.Id == one.OrderId || o.Id == two.OrderId).Select(o => o.Number).ToListAsync())).Order().ToList();
        Assert.Equal(expected, numbers);

        // a refund takes its ticket away
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/api/admin/orders/{one.OrderId}/mark-refunded", null)).StatusCode);
        draw = await Body(await admin.GetAsync("/api/admin/draw"));
        Assert.Equal(1, Assert.Single(draw.GetProperty("entries").EnumerateArray(), e => e.GetProperty("linkId").GetGuid() == linkId).GetProperty("tickets").GetInt32());
        // the draw is for the admin only
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/api/admin/draw")).StatusCode);
    }

    [Fact]
    public async Task The_statistics_count_verified_payments_as_revenue_and_keep_orders_games_and_players_apart()
    {
        var (f, _, live) = Site_();
        using var __ = f;
        var email = Unique("stats");
        var token = await NewLinkAsync(f.CreateClient(), email);
        var linkId = await LinkIdAsync(f, email);
        var visitor = Browser(f);
        var admin = await AdminAsync(f);
        var today = StatisticsService.ToIsrael(DateTime.UtcNow).ToString("yyyy-MM-dd");
        async Task<JsonElement> Stats() => await Body(await admin.GetAsync($"/api/admin/statistics?from={today}&to={today}&bucket=day"));
        var before = await Stats();

        await OpenLinkAsync(visitor, token);
        var paid = await OrderAsync(visitor, f);
        await NotifyAsync(f, live, paid, PaymentEventType.Succeeded);
        await OrderAsync(visitor, f);
        var failed = await OrderAsync(visitor, f);
        await NotifyAsync(f, live, failed, PaymentEventType.Failed);
        var room = await FreeGameAsync(visitor, f);
        var host = await SeatAsync(f, room);
        await RunAsync(f, room, host, "start", (e, r) => e.StartGame(r, host, DateTime.UtcNow));

        var after = await Stats();
        int D(string group, string field) => after.GetProperty(group).GetProperty(field).GetInt32() - before.GetProperty(group).GetProperty(field).GetInt32();
        Assert.Equal(3, D("sales", "ordersCreated"));
        Assert.Equal(1, D("sales", "purchases"));
        Assert.Equal(TestPurchase.Price, after.GetProperty("sales").GetProperty("net").GetDecimal() - before.GetProperty("sales").GetProperty("net").GetDecimal());
        Assert.Equal(1, D("sales", "pending"));
        Assert.Equal(1, D("sales", "failed"));
        Assert.Equal(1, D("activity", "freeOpened"));
        Assert.Equal(1, D("activity", "freeStarted"));
        Assert.Equal(1, D("activity", "participants"));
        Assert.Equal(1, D("referrals", "visits"));
        Assert.Equal(1, D("referrals", "freeGames"));
        // the chart of the day holds the same numbers as the totals
        var day = Assert.Single(after.GetProperty("series").EnumerateArray());
        Assert.Equal(after.GetProperty("sales").GetProperty("purchases").GetInt32(), day.GetProperty("purchases").GetInt32());
        Assert.Equal(after.GetProperty("sales").GetProperty("net").GetDecimal(), day.GetProperty("revenue").GetDecimal());
        var link = Assert.Single(after.GetProperty("referrals").GetProperty("links").EnumerateArray(), l => l.GetProperty("id").GetGuid() == linkId);
        Assert.Equal(1, link.GetProperty("purchases").GetInt32());
        Assert.Equal(1, link.GetProperty("freeGames").GetInt32());
        Assert.Equal(1, link.GetProperty("visits").GetInt32());
    }
}
