using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Mail;
using PortalX.Server.Newsletter;

namespace PortalX.Tests;

/// <summary>
/// Click tracking and the numbers of the "סודות הפורטל" mailings. No real email is sent: mailings are written straight
/// into the test database (or "sent" to <see cref="FastEmailSender"/>), and the clicks come through the public endpoint.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class NewsletterClickTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const string Site = "https://portalx.test";
    private const string Browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
    private readonly HubIntegrationTests.Factory _factory;

    public NewsletterClickTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private (WebApplicationFactory<Program> F, FastEmailSender Mail) Site_()
    {
        var mail = new FastEmailSender();
        var f = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PORTALX_SITE_URL"] = Site,
                ["Newsletter:PauseMs"] = "0",
                ["RateLimits:ReferralPer10Minutes"] = "100000",
                ["RateLimits:ReferralVisitsPerMinute"] = "100000",
                ["RateLimits:NewsletterClicksPerMinute"] = "100000",
                ["RateLimits:NewsletterOpensPerMinute"] = "100000",
            }));
            b.ConfigureTestServices(s => s.AddSingleton<IEmailSender>(mail));
        });
        return (f, mail);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>(Json);
    private static string Unique(string name) => $"{name}.{Guid.NewGuid():N}"[..22] + "@example.org";

    private static async Task<HttpClient> AdminAsync(WebApplicationFactory<Program> f)
    {
        var admin = f.CreateClient();
        (await admin.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        admin.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return admin;
    }

    private static async Task<string> SubscriberAsync(HttpClient http, string email, string first)
    {
        var r = await Body(await http.PostAsJsonAsync("/api/referrals", new { firstName = first, lastName = "כהן", email, marketingConsent = true, acceptTerms = true }));
        Assert.True(r.GetProperty("ok").GetBoolean(), r.ToString());
        return r.GetProperty("token").GetString()!;
    }

    private static async Task<T> DbAsync<T>(WebApplicationFactory<Program> f, Func<PortalDbContext, Task<T>> q)
    {
        using var scope = f.Services.CreateScope();
        return await q(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    /// <summary>A mailing already "sent" (rows written directly, nothing mailed): each address with its own tracked links.</summary>
    private static async Task<(Guid Id, Dictionary<string, Dictionary<string, string>> Urls)> SentAsync(
        WebApplicationFactory<Program> f, IEnumerable<(string Email, string Status)> to, DateTime? sentAt = null)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var tracking = scope.ServiceProvider.GetRequiredService<NewsletterTracking>();
        var at = sentAt ?? DateTime.UtcNow.AddHours(-1);
        var content = NewsletterContent.Welcome();
        var issue = new NewsletterIssue
        {
            Id = Guid.NewGuid(), Name = "בדיקת הקלקות " + Guid.NewGuid().ToString("N")[..6], ContentJson = content.ToJson(), Status = "sent",
            CreatedAt = at, UpdatedAt = at, TestedAt = at, SendStartedAt = at, SendFinishedAt = at,
        };
        db.NewsletterIssues.Add(issue);
        await db.SaveChangesAsync();
        var links = await tracking.EnsureLinksAsync(issue, content);
        var urls = new Dictionary<string, Dictionary<string, string>>();
        foreach (var (email, status) in to)
        {
            var d = new NewsletterDelivery { IssueId = issue.Id, Email = email, Status = status, At = at };
            db.NewsletterDeliveries.Add(d);
            await db.SaveChangesAsync();
            urls[email] = (await tracking.NewTrackerAsync(issue.Id, d.Id, null, links, Site))!;
        }
        return (issue.Id, urls);
    }

    private static string PathOf(string url) => url.StartsWith(Site) ? url[Site.Length..] : url;

    private static Task<HttpResponseMessage> ClickAsync(HttpClient http, string url, string? agent = Browser, string method = "GET")
    {
        var req = new HttpRequestMessage(new HttpMethod(method), PathOf(url));
        if (agent != null) req.Headers.TryAddWithoutValidation("User-Agent", agent);
        return http.SendAsync(req);
    }

    private static HttpClient NoRedirect(WebApplicationFactory<Program> f) => f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static string? AttributionCookie(HttpResponseMessage r) =>
        r.Headers.TryGetValues("Set-Cookie", out var all)
            ? all.Select(c => c.Split(';')[0]).FirstOrDefault(c => c.StartsWith(NewsletterTracking.AttributionCookie + "="))?.Split('=', 2)[1]
            : null;

    // ------------------------------------------------------------------ pure parts

    [Fact]
    public void Ctr_is_unique_clickers_over_emails_sent_and_scanners_are_told_apart()
    {
        Assert.Equal(66.7, NewsletterStats.Ctr(2, 3));
        Assert.Equal(100, NewsletterStats.Ctr(5, 5));
        Assert.Null(NewsletterStats.Ctr(0, 0));
        Assert.Equal(0, NewsletterStats.Ctr(0, 7));

        Assert.Null(NewsletterTracking.AutomatedReason(new("GET", Browser, null)));
        Assert.Equal("head", NewsletterTracking.AutomatedReason(new("HEAD", Browser, null)));
        Assert.Equal("prefetch", NewsletterTracking.AutomatedReason(new("GET", Browser, "prefetch")));
        Assert.Equal("agent", NewsletterTracking.AutomatedReason(new("GET", "", null)));
        Assert.Equal("agent", NewsletterTracking.AutomatedReason(new("GET", "python-requests/2.31", null)));
        Assert.Equal("agent", NewsletterTracking.AutomatedReason(new("GET", "Mozilla/5.0 (compatible; Barracuda Sentinel)", null)));
        Assert.Equal("agent", NewsletterTracking.AutomatedReason(new("GET", "Mozilla/5.0 (compatible; bingbot/2.0)", null)));

        Assert.Equal("game", NewsletterTracking.CategoryOf("/games/hanukkah-oil?coupon=PORTAL10"));
        Assert.Equal("catalog", NewsletterTracking.CategoryOf("/"));
        Assert.Equal("other", NewsletterTracking.CategoryOf("/guide"));
    }

    [Fact]
    public void The_buttons_carry_the_tracked_address_while_the_unsubscribe_link_stays_as_it_is()
    {
        var tracked = new Dictionary<string, string>
        {
            ["share"] = $"{Site}/newsletter/click/AAAAAAAAAAAAAAAAAAAAAAAA.1",
            ["cta"] = $"{Site}/newsletter/click/AAAAAAAAAAAAAAAAAAAAAAAA.2", ["home"] = $"{Site}/newsletter/click/AAAAAAAAAAAAAAAAAAAAAAAA.3",
        };
        var r = new NewsletterRecipient("a@example.org", "דנה", $"{Site}/my-link/TOKEN", $"{Site}/unsubscribe?t=U", tracked);
        var html = NewsletterTemplate.Html(NewsletterContent.Welcome(), r, new NewsletterSite(Site, "info@example.org"));
        foreach (var url in tracked.Values) Assert.Contains($"href=\"{url}\"", html);
        Assert.DoesNotContain("TOKEN", html);                                    // the share button too goes through the tracking
        Assert.Contains($"href=\"{Site}/unsubscribe?t=U\"", html);               // never tracked
        Assert.Contains("סודות הפורטל", html);
        var text = NewsletterTemplate.Text(NewsletterContent.Welcome(), r, new NewsletterSite(Site, "info@example.org"));
        Assert.Contains(tracked["cta"], text);
        // without tracking (the preview) nothing changes
        Assert.DoesNotContain("/newsletter/click/", NewsletterTemplate.Html(NewsletterContent.Welcome(), r with { Tracked = null }, new NewsletterSite(Site, "info@example.org")));
    }

    // ------------------------------------------------------------------ opens (an estimate)

    private const string GmailProxy = "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";

    [Fact]
    public void Each_sent_email_carries_its_own_invisible_picture_and_the_preview_none()
    {
        var pixel = $"{Site}/newsletter/open/AAAAAAAAAAAAAAAAAAAAAAAA.gif";
        var r = new NewsletterRecipient("a@example.org", "דנה", $"{Site}/my-link/TOKEN", $"{Site}/unsubscribe?t=U",
            new Dictionary<string, string> { ["open"] = pixel, ["cta"] = $"{Site}/newsletter/click/AAAAAAAAAAAAAAAAAAAAAAAA.2" });
        var html = NewsletterTemplate.Html(NewsletterContent.Welcome(), r, new NewsletterSite(Site, "info@example.org"));
        Assert.Matches($"<img src=\"{Regex.Escape(pixel)}\" width=\"1\" height=\"1\" alt=\"\"", html);
        Assert.Single(Regex.Matches(html, "/newsletter/open/"));
        Assert.DoesNotContain("/newsletter/open/", NewsletterTemplate.Text(NewsletterContent.Welcome(), r, new NewsletterSite(Site, "info@example.org")));
        Assert.DoesNotContain("/newsletter/open/", NewsletterTemplate.Html(NewsletterContent.Welcome(), r with { Tracked = null }, new NewsletterSite(Site, "info@example.org")));

        // a mail image proxy loads the picture for the reader: not a scanner (unlike a click without "Mozilla")
        Assert.Null(NewsletterTracking.OpenAutomatedReason(new("GET", GmailProxy, null)));
        Assert.Null(NewsletterTracking.OpenAutomatedReason(new("GET", "YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html", null)));
        Assert.Equal("agent", NewsletterTracking.OpenAutomatedReason(new("GET", "python-requests/2.31", null)));
        Assert.Equal("head", NewsletterTracking.OpenAutomatedReason(new("HEAD", Browser, null)));
    }

    [Fact]
    public async Task Opens_are_counted_once_per_email_from_the_picture_or_a_click_and_scanners_tests_and_early_loads_are_not()
    {
        var (f, mail) = Site_();
        using var __ = f;
        var (a, b, c, d, e) = (Unique("oa"), Unique("ob"), Unique("oc"), Unique("od"), Unique("oe"));
        var (one, urls) = await SentAsync(f, [(a, "sent"), (b, "sent"), (c, "sent"), (d, "sent"), (e, "failed")]);
        var http = f.CreateClient();

        // A opens: the transparent picture comes back, never cached, and the opening is recorded once
        var r = await ClickAsync(http, urls[a]["open"]);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("image/gif", r.Content.Headers.ContentType!.MediaType);
        Assert.Equal(NewsletterTracking.Pixel, await r.Content.ReadAsByteArrayAsync());
        Assert.Contains("no-store", r.Headers.CacheControl!.ToString());
        await ClickAsync(http, urls[a]["open"]);                                    // loaded again at once: the same opening
        Assert.Equal(1, await DbAsync(f, db => db.NewsletterOpenEvents.CountAsync(x => x.IssueId == one)));
        // only a few loadings are ever kept per email
        for (var i = 0; i < 8; i++)
        {
            await DbAsync(f, db => db.NewsletterOpenEvents.Where(x => x.IssueId == one).ExecuteUpdateAsync(s => s.SetProperty(x => x.OpenedAt, x => x.OpenedAt.AddMinutes(-5))));
            await ClickAsync(http, urls[a]["open"]);
        }
        Assert.Equal(NewsletterTracking.MaxOpens, await DbAsync(f, db => db.NewsletterOpenEvents.CountAsync(x => x.IssueId == one)));

        // B through Gmail's image proxy counts; C's picture was loaded by a scanner (not counted) but C clicked (counted)
        await ClickAsync(http, urls[b]["open"], GmailProxy);
        await ClickAsync(http, urls[c]["open"], "python-requests/2.31");
        await ClickAsync(NoRedirect(f), urls[c]["cta"]);
        // a broken or guessed address still gets the picture, and records nothing
        foreach (var bad in new[] { "/newsletter/open/AAAAAAAAAAAAAAAAAAAAAAAA.gif", "/newsletter/open/x.gif", "/newsletter/open/../../etc" })
            Assert.Equal(HttpStatusCode.OK, (await http.GetAsync(bad)).StatusCode);

        var admin = await AdminAsync(f);
        var cards = (await Body(await admin.GetAsync($"/api/admin/newsletters/{one}/stats"))).GetProperty("cards");
        Assert.Equal(4, cards.GetProperty("sent").GetInt32());
        Assert.Equal(3, cards.GetProperty("openers").GetInt32());                   // A, B (picture) and C (click)
        Assert.Equal(75, cards.GetProperty("openRate").GetDouble());
        Assert.Equal(2, cards.GetProperty("openedByPicture").GetInt32());
        Assert.Equal(1, cards.GetProperty("automatedOpens").GetInt32());
        Assert.Equal(33.3, cards.GetProperty("clickToOpen").GetDouble());           // 1 clicked of 3 who opened

        async Task<List<string>> Who(string filter) => (await Body(await admin.GetAsync($"/api/admin/newsletters/{one}/stats/recipients?filter={filter}")))
            .GetProperty("rows").EnumerateArray().Select(x => x.GetProperty("email").GetString()!).OrderBy(x => x).ToList();
        Assert.Equal(new[] { a, b, c }.OrderBy(x => x), await Who("opened"));
        Assert.Equal(new[] { d }, await Who("not-opened"));                        // the failed email is not "not opened"
        var cmp = (await Body(await admin.GetAsync("/api/admin/newsletters/compare"))).GetProperty("issues").EnumerateArray()
            .Single(x => x.GetProperty("id").GetGuid() == one);
        Assert.Equal(3, cmp.GetProperty("openers").GetInt32());
        Assert.Equal(75, cmp.GetProperty("openRate").GetDouble());

        // a picture loaded seconds after sending is the mail system, not a reader; a test email's opens never count
        var (two, urls2) = await SentAsync(f, [(a, "sent")], DateTime.UtcNow);
        await ClickAsync(http, urls2[a]["open"]);
        var testUrls = await DbAsync(f, async db =>
        {
            var tracking = new NewsletterTracking(db, NullLogger<NewsletterTracking>.Instance);
            var links = await db.NewsletterLinks.Where(l => l.IssueId == two).ToDictionaryAsync(l => l.Kind);
            return (await tracking.NewTrackerAsync(two, null, "tester@example.org", links, Site))!;
        });
        await ClickAsync(http, testUrls["open"]);
        var cards2 = (await Body(await admin.GetAsync($"/api/admin/newsletters/{two}/stats"))).GetProperty("cards");
        Assert.Equal(0, cards2.GetProperty("openers").GetInt32());
        Assert.Equal(1, cards2.GetProperty("automatedOpens").GetInt32());
        Assert.Equal(1, cards2.GetProperty("testOpens").GetInt32());
        Assert.Equal("too-fast", await DbAsync(f, db => db.NewsletterOpenEvents.Where(x => x.IssueId == two && !x.IsTest).Select(x => x.AutomatedReason).SingleAsync()));

        // no IP is kept, and nothing was mailed
        Assert.Empty(mail.Sent);
    }

    // ------------------------------------------------------------------ clicks and numbers

    [Fact]
    public async Task A_click_is_recorded_and_redirected_people_count_once_clicks_count_every_time_and_each_mailing_and_recipient_keeps_its_own()
    {
        var (f, mail) = Site_();
        using var __ = f;
        var (a, b, c, d) = (Unique("ca"), Unique("cb"), Unique("cc"), Unique("cd"));
        var signup = f.CreateClient();
        var tokenA = await SubscriberAsync(signup, a, "אלף");
        var tokenB = await SubscriberAsync(signup, b, "בית");
        await SubscriberAsync(signup, c, "גימל");
        mail.Sent.Clear();

        var consentsBefore = await DbAsync(f, db => db.MarketingConsents.AsNoTracking().Where(x => x.Email == a || x.Email == b || x.Email == c)
            .OrderBy(x => x.Email).Select(x => new { x.Email, x.Status, x.ConsentedAt, x.RevokedAt }).ToListAsync());
        var allConsents = await DbAsync(f, db => db.MarketingConsents.CountAsync());

        var (one, urls) = await SentAsync(f, [(a, "sent"), (b, "sent"), (c, "sent"), (d, "failed")]);
        var (two, urls2) = await SentAsync(f, [(a, "sent")]);
        var deliveriesBefore = await DbAsync(f, db => db.NewsletterDeliveries.AsNoTracking().Where(x => x.IssueId == one)
            .OrderBy(x => x.Id).Select(x => new { x.Email, x.Status, x.At }).ToListAsync());

        // A opens the main button: recorded, sent to its stored destination, and the browser gets the purchase key
        var browserA = NoRedirect(f);
        var r = await ClickAsync(browserA, urls[a]["cta"]);
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        Assert.Equal("/games/hanukkah-oil?coupon=PORTAL10", r.Headers.Location!.OriginalString);
        Assert.Equal("no-store", r.Headers.CacheControl!.ToString());
        Assert.NotNull(AttributionCookie(r));

        // the same click sent again at once is one click
        await ClickAsync(browserA, urls[a]["cta"]);
        Assert.Equal(1, await DbAsync(f, db => db.NewsletterClickEvents.CountAsync(x => x.IssueId == one)));

        // a real second click later counts as a click, not as a second person
        await DbAsync(f, db => db.NewsletterClickEvents.Where(x => x.IssueId == one).ExecuteUpdateAsync(s => s.SetProperty(x => x.ClickedAt, x => x.ClickedAt.AddMinutes(-2))));
        await ClickAsync(browserA, urls[a]["cta"]);

        // the share button opens the page with the recipient's own personal link, never someone else's
        var g = await ClickAsync(browserA, urls[a]["share"]);
        Assert.Equal($"/my-link/{tokenA}", g.Headers.Location!.OriginalString);
        var gb = await ClickAsync(NoRedirect(f), urls[b]["share"]);
        Assert.Equal($"/my-link/{tokenB}", gb.Headers.Location!.OriginalString);
        // a query added by hand changes nothing
        var forged = await ClickAsync(NoRedirect(f), urls[b]["home"] + "?to=https://evil.example&url=//evil.example");
        Assert.Equal("/", forged.Headers.Location!.OriginalString);

        var admin = await AdminAsync(f);
        var s = await Body(await admin.GetAsync($"/api/admin/newsletters/{one}/stats"));
        var cards = s.GetProperty("cards");
        Assert.Equal(3, cards.GetProperty("sent").GetInt32());
        Assert.Equal(1, cards.GetProperty("failed").GetInt32());
        Assert.Equal(2, cards.GetProperty("clickers").GetInt32());          // A and B
        Assert.Equal(5, cards.GetProperty("clicks").GetInt32());            // A: cta ×2 + share, B: share + home
        Assert.Equal(66.7, cards.GetProperty("ctr").GetDouble());           // 2 ÷ 3
        Assert.Equal(0, cards.GetProperty("automated").GetInt32());
        var links = s.GetProperty("links").EnumerateArray().ToDictionary(l => l.GetProperty("kind").GetString()!);
        Assert.Equal(1, links["cta"].GetProperty("unique").GetInt32());
        Assert.Equal(2, links["cta"].GetProperty("clicks").GetInt32());
        Assert.Equal(2, links["share"].GetProperty("unique").GetInt32());
        Assert.Equal("share", links["share"].GetProperty("category").GetString());
        Assert.Equal(33.3, links["cta"].GetProperty("ctr").GetDouble());

        // the other mailing (also to A) has none of these clicks
        var s2 = await Body(await admin.GetAsync($"/api/admin/newsletters/{two}/stats"));
        Assert.Equal(0, s2.GetProperty("cards").GetProperty("clicks").GetInt32());
        Assert.Equal(0, s2.GetProperty("cards").GetProperty("clickers").GetInt32());
        // and its own click lands in its own numbers only
        await ClickAsync(NoRedirect(f), urls2[a]["home"]);
        Assert.Equal(1, (await Body(await admin.GetAsync($"/api/admin/newsletters/{two}/stats"))).GetProperty("cards").GetProperty("clicks").GetInt32());
        Assert.Equal(5, (await Body(await admin.GetAsync($"/api/admin/newsletters/{one}/stats"))).GetProperty("cards").GetProperty("clicks").GetInt32());

        // who clicked, with the filters
        async Task<List<string>> Who(string filter) => (await Body(await admin.GetAsync($"/api/admin/newsletters/{one}/stats/recipients?filter={filter}")))
            .GetProperty("rows").EnumerateArray().Select(x => x.GetProperty("email").GetString()!).OrderBy(x => x).ToList();
        Assert.Equal(new[] { a, b }.OrderBy(x => x), await Who("clicked"));
        Assert.Equal(new[] { c, d }.OrderBy(x => x), await Who("not-clicked"));
        Assert.Equal(new[] { a }, await Who("game"));                         // the main button opens the game page
        Assert.Equal(new[] { b }, await Who("catalog"));                      // the site link at the bottom
        Assert.Equal(new[] { a, b }.OrderBy(x => x), await Who("share"));
        Assert.Empty(await Who("purchased"));
        var rowA = (await Body(await admin.GetAsync($"/api/admin/newsletters/{one}/stats/recipients?filter=clicked")))
            .GetProperty("rows").EnumerateArray().Single(x => x.GetProperty("email").GetString() == a);
        Assert.Equal(3, rowA.GetProperty("clicks").GetInt32());
        Assert.Equal("אלף", rowA.GetProperty("name").GetString());

        // the comparison lists both mailings with their own numbers
        var cmp = (await Body(await admin.GetAsync("/api/admin/newsletters/compare"))).GetProperty("issues").EnumerateArray().ToList();
        Assert.Equal(66.7, cmp.Single(x => x.GetProperty("id").GetGuid() == one).GetProperty("ctr").GetDouble());
        Assert.Equal(100, cmp.Single(x => x.GetProperty("id").GetGuid() == two).GetProperty("ctr").GetDouble());

        // the numbers are for the admin only
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync($"/api/admin/newsletters/{one}/stats")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync($"/api/admin/newsletters/{one}/stats/recipients")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/api/admin/newsletters/compare")).StatusCode);

        // nothing was mailed, and consents and deliveries are exactly as they were
        Assert.Empty(mail.Sent);
        Assert.Equal(allConsents, await DbAsync(f, db => db.MarketingConsents.CountAsync()));
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(consentsBefore), System.Text.Json.JsonSerializer.Serialize(
            await DbAsync(f, db => db.MarketingConsents.AsNoTracking().Where(x => x.Email == a || x.Email == b || x.Email == c)
                .OrderBy(x => x.Email).Select(x => new { x.Email, x.Status, x.ConsentedAt, x.RevokedAt }).ToListAsync())));
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(deliveriesBefore), System.Text.Json.JsonSerializer.Serialize(
            await DbAsync(f, db => db.NewsletterDeliveries.AsNoTracking().Where(x => x.IssueId == one)
                .OrderBy(x => x.Id).Select(x => new { x.Email, x.Status, x.At }).ToListAsync())));
    }

    [Fact]
    public async Task A_broken_or_guessed_address_never_leaves_the_site_and_one_recipients_key_never_opens_another_mailing()
    {
        var (f, _) = Site_();
        using var __ = f;
        var a = Unique("bad");
        await SubscriberAsync(f.CreateClient(), a, "דוד");
        var (one, urls) = await SentAsync(f, [(a, "sent")]);
        var http = NoRedirect(f);
        var token = urls[a]["cta"].Split('/').Last().Split('.')[0];
        var bad = new[]
        {
            "/newsletter/click/nothing", "/newsletter/click/AAAAAAAAAAAAAAAAAAAAAAAA.1", $"/newsletter/click/{token}.99", $"/newsletter/click/{token}.0",
            $"/newsletter/click/{token}", "/newsletter/click/%2F%2Fevil.example", $"/newsletter/click/{token[..^1]}x.1", "/newsletter/click/https:%2F%2Fevil.example.1",
        };
        foreach (var path in bad)
        {
            var r = await http.GetAsync(path);
            Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
            Assert.Equal("/", r.Headers.Location!.OriginalString);
        }
        Assert.Equal(0, await DbAsync(f, db => db.NewsletterClickEvents.CountAsync(x => x.IssueId == one)));

        // a stored destination that is not a site path or https (written by hand) is still never followed
        await DbAsync(f, db => db.NewsletterLinks.Where(l => l.IssueId == one && l.Kind == "cta")
            .ExecuteUpdateAsync(s => s.SetProperty(l => l.Destination, "//evil.example/x")));
        Assert.Equal("/", (await ClickAsync(http, urls[a]["cta"])).Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task Scanner_clicks_are_kept_apart_and_never_counted_as_people_or_given_a_purchase_key()
    {
        var (f, _) = Site_();
        using var __ = f;
        var (a, b, c) = (Unique("sa"), Unique("sb"), Unique("sc"));
        var signup = f.CreateClient();
        foreach (var e in new[] { a, b, c }) await SubscriberAsync(signup, e, "רות");
        var (one, urls) = await SentAsync(f, [(a, "sent"), (b, "sent")]);
        var http = NoRedirect(f);

        // browser names of scanners, a HEAD peek and a prefetch
        var scan = await ClickAsync(http, urls[a]["cta"], "Mozilla/5.0 (compatible; Proofpoint URL Defense)");
        Assert.Equal("/games/hanukkah-oil?coupon=PORTAL10", scan.Headers.Location!.OriginalString);   // it still goes on
        Assert.Null(AttributionCookie(scan));
        await ClickAsync(http, urls[a]["share"], null);
        await ClickAsync(http, urls[a]["home"], Browser, "HEAD");
        // B's scanner opens every link within a second, in a normal browser name
        foreach (var kind in new[] { "share", "home", "cta" }) await ClickAsync(http, urls[b][kind]);

        // an email opened on arrival (seconds after it was sent)
        var (fresh, freshUrls) = await SentAsync(f, [(c, "sent")], DateTime.UtcNow);
        var quick = await ClickAsync(http, freshUrls[c]["cta"]);
        Assert.Null(AttributionCookie(quick));

        var admin = await AdminAsync(f);
        var cards = (await Body(await admin.GetAsync($"/api/admin/newsletters/{one}/stats"))).GetProperty("cards");
        Assert.Equal(0, cards.GetProperty("clickers").GetInt32());
        Assert.Equal(0, cards.GetProperty("clicks").GetInt32());
        Assert.Equal(6, cards.GetProperty("automated").GetInt32());
        Assert.Equal(0, cards.GetProperty("ctr").GetDouble());
        var reasons = await DbAsync(f, db => db.NewsletterClickEvents.Where(x => x.IssueId == one).Select(x => x.AutomatedReason).ToListAsync());
        Assert.All(reasons, x => Assert.NotNull(x));
        Assert.Contains("burst", reasons);
        Assert.Contains("head", reasons);
        Assert.Contains("agent", reasons);
        Assert.Equal("too-fast", await DbAsync(f, db => db.NewsletterClickEvents.Where(x => x.IssueId == fresh).Select(x => x.AutomatedReason).SingleAsync()));
        Assert.Equal(0, await DbAsync(f, db => db.NewsletterClickEvents.CountAsync(x => (x.IssueId == one || x.IssueId == fresh) && x.AttributionHash != null)));
    }

    [Fact]
    public async Task Test_emails_go_through_the_tracking_but_their_clicks_never_count()
    {
        var (f, mail) = Site_();
        using var __ = f;
        var a = Unique("ta");
        var tokenA = await SubscriberAsync(f.CreateClient(), a, "תמר");
        var admin = await AdminAsync(f);
        var id = (await Body(await admin.PostAsJsonAsync("/api/admin/newsletters", new { from = "welcome" }))).GetProperty("id").GetGuid();
        mail.Sent.Clear();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/admin/newsletters/{id}/test", new { emails = new[] { a } })).StatusCode);
        var html = Assert.Single(mail.Sent).Html;
        var hrefs = Regex.Matches(html, "href=\"(https://portalx\\.test/newsletter/click/[^\"]+)\"").Select(m => m.Groups[1].Value).ToList();
        Assert.Equal(3, hrefs.Count);                                   // the share button, the main button, the site in the footer
        Assert.DoesNotContain(tokenA, html);                            // the link itself is on the copy page, not in the email

        var r = await ClickAsync(NoRedirect(f), hrefs[0]);
        Assert.Equal($"/my-link/{tokenA}", r.Headers.Location!.OriginalString);
        Assert.Null(AttributionCookie(r));
        var cards = (await Body(await admin.GetAsync($"/api/admin/newsletters/{id}/stats"))).GetProperty("cards");
        Assert.Equal(1, cards.GetProperty("testClicks").GetInt32());
        Assert.Equal(0, cards.GetProperty("clicks").GetInt32());
        Assert.Equal(0, cards.GetProperty("clickers").GetInt32());
        Assert.Equal(0, await DbAsync(f, db => db.NewsletterDeliveries.CountAsync(x => x.IssueId == id)));
        await admin.DeleteAsync($"/api/admin/newsletters/{id}");
    }

    // ------------------------------------------------------------------ purchases

    [Fact]
    public async Task A_purchase_counts_only_through_the_clicks_own_browser_key_within_the_window()
    {
        var (f, _) = Site_();
        using var __ = f;
        var (a, b, c) = (Unique("pa"), Unique("pb"), Unique("pc"));
        var signup = f.CreateClient();
        foreach (var e in new[] { a, b, c }) await SubscriberAsync(signup, e, "מיכל");
        var (one, urls) = await SentAsync(f, [(a, "sent"), (b, "sent"), (c, "sent")]);

        var keyA = AttributionCookie(await ClickAsync(NoRedirect(f), urls[a]["cta"]))!;
        var keyB = AttributionCookie(await ClickAsync(NoRedirect(f), urls[b]["cta"]))!;
        await ClickAsync(NoRedirect(f), urls[c]["cta"]);
        Assert.NotNull(keyA);
        // B's click is 8 days old: outside the window
        var deliveryB = await DbAsync(f, db => db.NewsletterDeliveries.Where(d => d.IssueId == one && d.Email == b).Select(d => d.Id).SingleAsync());
        var eightDaysAgo = DateTime.UtcNow.AddDays(-8);
        await DbAsync(f, db => db.NewsletterClickEvents.Where(x => x.DeliveryId == deliveryB)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.ClickedAt, eightDaysAgo)));

        var orders = new List<Guid>();
        try
        {
            async Task<Guid> Order(string? email, OrderStatus status, decimal price, bool test = false) => await DbAsync(f, async db =>
            {
                var p = await db.Products.AsNoTracking().OrderBy(x => x.Id).FirstAsync();
                var now = DateTime.UtcNow;
                var o = new Order
                {
                    Id = Guid.NewGuid(), ProductId = p.Id, ProductName = p.Name, PriceSnapshot = price, Status = status, Provider = "sumit", IsTest = test,
                    Email = email, AccessKeyHash = "x", CreatedAt = now, UpdatedAt = now, PaidAt = status == OrderStatus.Paid ? now : null,
                };
                db.Orders.Add(o);
                await db.SaveChangesAsync();
                orders.Add(o.Id);
                return o.Id;
            });
            async Task Attribute(Guid order, string? key) => await DbAsync(f, async db =>
            {
                await new NewsletterTracking(db, NullLogger<NewsletterTracking>.Instance).AttributeAsync(order, key, DateTime.UtcNow);
                return 0;
            });

            var paidA = await Order(a, OrderStatus.Paid, 89.1m);
            await Attribute(paidA, keyA);                               // the click's own key: counts
            var pendingA = await Order(a, OrderStatus.Pending, 89.1m);
            await Attribute(pendingA, keyA);                            // not paid: tied, but not counted
            var lateB = await Order(b, OrderStatus.Paid, 99m);
            await Attribute(lateB, keyB);                               // 8 days later: not tied
            var otherC = await Order(c, OrderStatus.Paid, 99m);
            await Attribute(otherC, null);                              // another browser: no key
            var guessed = await Order(null, OrderStatus.Paid, 99m);
            await Attribute(guessed, "AAAAAAAAAAAAAAAAAAAAAAAA");      // an unknown key

            Assert.Equal(new[] { paidA, pendingA }.OrderBy(x => x),
                (await DbAsync(f, db => db.NewsletterOrderAttributions.Where(x => orders.Contains(x.OrderId)).Select(x => x.OrderId).ToListAsync())).OrderBy(x => x));

            var admin = await AdminAsync(f);
            var cards = (await Body(await admin.GetAsync($"/api/admin/newsletters/{one}/stats"))).GetProperty("cards");
            Assert.Equal(1, cards.GetProperty("purchases").GetInt32());
            Assert.Equal(89.1m, cards.GetProperty("revenue").GetDecimal());
            var rows = (await Body(await admin.GetAsync($"/api/admin/newsletters/{one}/stats/recipients"))).GetProperty("rows").EnumerateArray()
                .ToDictionary(x => x.GetProperty("email").GetString()!);
            Assert.Equal("yes", rows[a].GetProperty("purchase").GetString());
            // C bought after clicking, but nothing ties that order to the email: shown as "לא ניתן לשייך", never counted
            Assert.Equal("unknown", rows[c].GetProperty("purchase").GetString());
            Assert.False(rows[b].TryGetProperty("purchase", out var none) && none.ValueKind != JsonValueKind.Null);   // nothing (the API omits nulls)
            var purchased = (await Body(await admin.GetAsync($"/api/admin/newsletters/{one}/stats/recipients?filter=purchased"))).GetProperty("rows");
            Assert.Equal(a, Assert.Single(purchased.EnumerateArray()).GetProperty("email").GetString());
        }
        finally
        {
            // the shared test database keeps no extra orders for other tests
            await DbAsync(f, db => db.Orders.Where(o => orders.Contains(o.Id)).ExecuteDeleteAsync());
        }
    }

    // ------------------------------------------------------------------ failures

    private sealed class FailingSaves : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData e, InterceptionResult<int> r, CancellationToken ct = default) =>
            throw new DbUpdateException("the database is not writable");
    }

    [Fact]
    public async Task When_recording_fails_the_reader_still_reaches_the_link()
    {
        var (f, _) = Site_();
        using var __ = f;
        var a = Unique("fa");
        await SubscriberAsync(f.CreateClient(), a, "עדי");
        var (one, urls) = await SentAsync(f, [(a, "sent")]);
        var raw = urls[a]["cta"].Split('/').Last();

        using var scope = f.Services.CreateScope();
        var options = scope.ServiceProvider.GetRequiredService<DbContextOptions<PortalDbContext>>();
        await using var broken = new PortalDbContext(new DbContextOptionsBuilder<PortalDbContext>(options).AddInterceptors(new FailingSaves()).Options);
        var result = await new NewsletterTracking(broken, NullLogger<NewsletterTracking>.Instance).ClickAsync(raw, new("GET", Browser, null), DateTime.UtcNow);
        Assert.Equal("/games/hanukkah-oil?coupon=PORTAL10", result.Target);
        Assert.Null(result.AttributionToken);
        Assert.Equal(0, await DbAsync(f, db => db.NewsletterClickEvents.CountAsync(x => x.IssueId == one)));

        // and a purchase is never stopped by it
        await new NewsletterTracking(broken, NullLogger<NewsletterTracking>.Instance).AttributeAsync(Guid.NewGuid(), "AAAAAAAAAAAAAAAAAAAAAAAA", DateTime.UtcNow);
    }
}
