using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Mail;
using PortalX.Server.Newsletter;

namespace PortalX.Tests;

/// <summary>"סודות הפורטל": the fixed template, the editable content, personal links per recipient and the guarded send.</summary>
[Collection(DatabaseCollection.Name)]
public class NewsletterTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const string Site = "https://portalx.test";
    private readonly HubIntegrationTests.Factory _factory;

    public NewsletterTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private static readonly NewsletterSite SiteInfo = new(Site, "info.portalx@gmail.com");

    // ------------------------------------------------------------------ the template

    [Fact]
    public void The_welcome_email_keeps_the_riddle_word_for_word_and_every_fixed_part()
    {
        var c = NewsletterContent.Welcome();
        Assert.Null(c.Validate());
        var r = new NewsletterRecipient("a@example.org", "דנה", $"{Site}/r/TOKENA?to=hanukkah-oil", $"{Site}/r/TOKENA", $"{Site}/unsubscribe#t=abc");
        var html = NewsletterTemplate.Html(c, r, SiteInfo);

        // the five clues as supplied, each code next to its own text
        foreach (var (code, text) in new[]
        {
            ("682", "ספרה אחת נכונה נמצאת במקום הנכון."), ("614", "ספרה אחת נכונה, אבל נמצאת במקום הלא נכון."),
            ("206", "שתי ספרות נכונות, אבל שתיהן במקומות הלא נכונים."), ("738", "אף ספרה אינה נכונה."),
            ("780", "ספרה אחת נכונה, אבל נמצאת במקום הלא נכון."),
        })
            Assert.Matches($"{code}</td>\\s*<td[^>]*>{System.Text.RegularExpressions.Regex.Escape(System.Net.WebUtility.HtmlEncode(text))}</td>", html);
        Assert.Contains("אתם עומדים מול תיבה נעולה בקוד בן 3 ספרות.", html);
        Assert.Contains("מהו הקוד שפותח את התיבה?", html);
        Assert.Contains("השיבו למייל הזה עם הקוד שפתחתם", html);

        // fixed parts
        Assert.Contains("lang=\"he\" dir=\"rtl\"", html);
        Assert.Contains("🔐 סודות הפורטל", html);
        Assert.Contains("חידות <span", html);
        Assert.Contains($"src=\"{Site}/img/mail/portal-x-logo.png\"", html);
        Assert.Contains("alt=\"PORTAL-X\"", html);
        Assert.Contains("מחכים לכם מעבר לפורטל!", html);
        Assert.Contains("צוות PORTAL-X", html);
        Assert.Contains("width=\"600\"", html);
        Assert.Contains("שלום דנה,", html);

        // offer: the code is live text; the button opens the game with the code
        Assert.Contains(">PORTAL10</span>", html);
        Assert.Contains("<span dir=\"ltr\">10%</span> הנחה", html);
        Assert.Contains($"href=\"{Site}/games/hanukkah-oil?coupon=PORTAL10\"", html);

        // personal links and the personal unsubscribe link
        Assert.Contains($"href=\"{Site}/r/TOKENA?to=hanukkah-oil\"", html);
        Assert.Contains($"href=\"{Site}/r/TOKENA\"", html);
        Assert.Contains($"href=\"{Site}/unsubscribe#t=abc\"", html);

        // email-safe: no script, no flex/grid layout, no external stylesheet, no background images; small enough for Gmail
        Assert.DoesNotContain("<script", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("display:flex", html);
        Assert.DoesNotContain("display:grid", html);
        Assert.DoesNotContain("<link", html);
        Assert.DoesNotContain("url(", html);
        Assert.True(Encoding.UTF8.GetByteCount(html) < NewsletterService.ClipWarnBytes, $"{Encoding.UTF8.GetByteCount(html)} bytes");
        // every picture has alt text
        Assert.All(System.Text.RegularExpressions.Regex.Matches(html, "<img [^>]*>").Select(m => m.Value), img => Assert.Contains("alt=\"", img));

        Assert.Equal("פרסומת: ברוכים הבאים לסודות הפורטל! חידה ראשונה והטבה מיוחדת", NewsletterTemplate.Subject(c));

        var dump = Environment.GetEnvironmentVariable("PORTALX_NEWSLETTER_DUMP");
        if (!string.IsNullOrEmpty(dump))
        {
            File.WriteAllText(Path.Combine(dump, "welcome.html"), html);
            File.WriteAllText(Path.Combine(dump, "welcome-no-links.html"), NewsletterTemplate.Html(c, r with { GameLinkUrl = null, SiteLinkUrl = null }, SiteInfo));
            File.WriteAllText(Path.Combine(dump, "welcome.txt"), NewsletterTemplate.Text(c, r, SiteInfo));
            File.WriteAllText(Path.Combine(dump, "welcome-sample.html"), NewsletterTemplate.Html(c, NewsletterService.Sample(Site), SiteInfo));
        }
    }

    [Fact]
    public void A_recipient_without_personal_links_gets_no_link_buttons_and_never_a_placeholder_link()
    {
        var c = NewsletterContent.Welcome();
        var html = NewsletterTemplate.Html(c, new NewsletterRecipient("b@example.org", null, null, null, $"{Site}/unsubscribe#t=b"), SiteInfo);
        Assert.DoesNotContain("🔗 הקישורים האישיים שלכם", html);
        Assert.DoesNotContain("/r/", html);
        Assert.DoesNotContain("שלום ", html);
        // the offer then takes the full width
        Assert.Contains("max-width:564px", html);
        // only one of the two links: only its button
        var one = NewsletterTemplate.Html(c, new NewsletterRecipient("b@example.org", null, null, $"{Site}/r/T", null), SiteInfo);
        Assert.Contains("אתר המשחקים PORTAL-X – הקישור האישי שלי", one);
        Assert.DoesNotContain("סוד פך השמן – הקישור האישי שלי", one);
    }

    [Fact]
    public void Editor_text_is_always_escaped_and_hidden_blocks_are_left_out()
    {
        var c = NewsletterContent.Welcome();
        c.Intro.Text = "<script>alert(1)</script> **חשוב** \n- שורה";
        c.Sections[0].Show = false;
        c.Offer.Show = false;
        c.Cta.Show = false;
        var html = NewsletterTemplate.Html(c, NewsletterService.Sample(Site), SiteInfo);
        Assert.DoesNotContain("<script>alert", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.Contains("<b>חשוב</b>", html);
        Assert.Contains("✦</span>&nbsp;שורה", html);
        Assert.DoesNotContain("התגובות הראשונות הגיעו", html);
        Assert.DoesNotContain("PORTAL10", html);
        Assert.DoesNotContain("למשחק סוד פך השמן", html);
        // without a real unsubscribe link (preview / sample) the footer says where it will be
        Assert.Contains("קישור ההסרה האישי", html);
    }

    [Theory]
    [InlineData("//evil.example/x")]
    [InlineData("javascript:alert(1)")]
    [InlineData("http://plain.example")]
    [InlineData("/a\"onmouseover=\"x")]
    public void The_button_only_leads_to_the_site_or_a_full_https_address(string url)
    {
        var c = NewsletterContent.Welcome();
        c.Cta.Url = url;
        Assert.NotNull(c.Validate());
    }

    [Fact]
    public void Content_rules()
    {
        var c = NewsletterContent.Welcome();
        c.Offer.Code = "PORTAL 10"; Assert.NotNull(c.Validate());
        c = NewsletterContent.Welcome(); c.Offer.Percent = 0; Assert.NotNull(c.Validate());
        c = NewsletterContent.Welcome(); c.Links.GameId = "../admin"; Assert.NotNull(c.Validate());
        c = NewsletterContent.Welcome(); c.Subject = " "; Assert.NotNull(c.Validate());
        c = NewsletterContent.Welcome(); c.Sections[1].Clues.Clear(); Assert.NotNull(c.Validate());
        c = NewsletterContent.Welcome(); c.Offer.ImageUrl = "http://x.example/a.png"; Assert.NotNull(c.Validate());
        c = NewsletterContent.Welcome(); c.Cta.Url = "https://portalx.co.il/games"; Assert.Null(c.Validate());
        // round trip through the stored JSON
        Assert.Equal(NewsletterContent.Welcome().ToJson(), NewsletterContent.FromJson(NewsletterContent.Welcome().ToJson()).ToJson());
    }

    // ------------------------------------------------------------------ the site and the admin API

    private (WebApplicationFactory<Program> F, FastEmailSender Mail) Site_()
    {
        var mail = new FastEmailSender();
        var f = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PORTALX_SITE_URL"] = Site,
                ["Newsletter:PauseMs"] = "0",
                // the shared test database keeps the subscribers (and deliveries) of every earlier run
                ["PORTALX_NEWSLETTER_DAILY_LIMIT"] = "100000000",
                ["RateLimits:ReferralPer10Minutes"] = "100000",
                ["RateLimits:ReferralResendPer10Minutes"] = "100000",
                ["RateLimits:ReferralVisitsPerMinute"] = "100000",
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

    /// <summary>A subscriber made the real way: the personal-link form with the marketing tick.</summary>
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

    [Fact]
    public async Task The_personal_game_link_lands_on_its_game_page_and_never_off_the_site()
    {
        var (f, _) = Site_();
        using var __ = f;
        var http = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var token = await SubscriberAsync(f.CreateClient(), Unique("land"), "נועה");
        var r = await http.GetAsync($"/r/{token}?to=hanukkah-oil");
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        Assert.Equal("/games/hanukkah-oil", r.Headers.Location!.OriginalString);
        foreach (var bad in new[] { "//evil.example", "https%3A%2F%2Fevil.example", "../admin", "HANUKKAH" })
        {
            var b = await http.GetAsync($"/r/{token}?to={bad}");
            Assert.Equal("/", b.Headers.Location!.OriginalString);
        }
    }

    [Fact]
    public async Task Each_recipient_gets_only_their_own_links_the_list_needs_a_test_and_a_typed_count_and_nobody_is_mailed_twice()
    {
        var (f, mail) = Site_();
        using var __ = f;
        var http = f.CreateClient();
        var admin = await AdminAsync(f);
        var (a, b, gone) = (Unique("alef"), Unique("bet"), Unique("gone"));
        var tokenA = await SubscriberAsync(http, a, "אלף");
        var tokenB = await SubscriberAsync(http, b, "בית");
        await SubscriberAsync(http, gone, "גימל");
        // one subscriber unsubscribed: never mailed
        await DbAsync(f, async db =>
        {
            var c = await db.MarketingConsents.FirstAsync(x => x.Email == gone);
            c.Status = ConsentStatus.Revoked; c.RevokedAt = DateTime.UtcNow;
            return await db.SaveChangesAsync();
        });
        mail.Sent.Clear();

        var id = (await Body(await admin.PostAsJsonAsync("/api/admin/newsletters", new { from = "welcome" }))).GetProperty("id").GetGuid();

        // the preview for one address shows that address's own links
        var preview = await Body(await admin.PostAsJsonAsync("/api/admin/newsletters/preview", new { content = NewsletterContent.Welcome(), email = a }));
        Assert.Contains($"/r/{tokenA}?to=hanukkah-oil", preview.GetProperty("html").GetString());
        Assert.DoesNotContain(tokenB, preview.GetProperty("html").GetString());

        // not tested yet: the list cannot be mailed
        var detail = await Body(await admin.GetAsync($"/api/admin/newsletters/{id}"));
        var pending = detail.GetProperty("pending").GetInt32();
        var early = await admin.PostAsJsonAsync($"/api/admin/newsletters/{id}/send", new { confirm = pending });
        Assert.Equal(HttpStatusCode.Conflict, early.StatusCode);
        Assert.Equal("not-tested", (await Body(early)).GetProperty("code").GetString());

        // a test to two addresses: each gets its own links and its own unsubscribe link, marked as a test
        var test = await admin.PostAsJsonAsync($"/api/admin/newsletters/{id}/test", new { emails = new[] { a, b } });
        Assert.Equal(HttpStatusCode.OK, test.StatusCode);
        Assert.Equal(2, mail.Sent.Count);
        var toA = mail.Sent.Single(m => m.To == a);
        var toB = mail.Sent.Single(m => m.To == b);
        Assert.StartsWith(NewsletterService.TestPrefix + "פרסומת:", toA.Subject);
        Assert.Contains(tokenA, toA.Html); Assert.DoesNotContain(tokenB, toA.Html);
        Assert.Contains(tokenB, toB.Html); Assert.DoesNotContain(tokenA, toB.Html);
        Assert.NotNull(toA.UnsubscribeUrl);
        Assert.NotEqual(toA.UnsubscribeUrl, toB.UnsubscribeUrl);
        Assert.Contains(toA.UnsubscribeUrl!, toA.Html);
        Assert.Contains("שלום אלף,", toA.Html);
        // a test records no delivery
        Assert.Equal(0, await DbAsync(f, db => db.NewsletterDeliveries.CountAsync(d => d.IssueId == id)));

        // the typed number must be the server's own count
        var wrong = await admin.PostAsJsonAsync($"/api/admin/newsletters/{id}/send", new { confirm = pending + 1 });
        Assert.Equal("confirm", (await Body(wrong)).GetProperty("code").GetString());

        mail.Sent.Clear();
        var go = await admin.PostAsJsonAsync($"/api/admin/newsletters/{id}/send", new { confirm = pending });
        Assert.Equal(HttpStatusCode.OK, go.StatusCode);
        await f.Services.GetRequiredService<NewsletterRunner>().Last!;

        // every active subscriber got exactly one email, the unsubscribed one none
        var after = await Body(await admin.GetAsync($"/api/admin/newsletters/{id}"));
        Assert.True(pending == mail.Sent.Count, after.ToString());
        Assert.Equal(mail.Sent.Count, mail.Sent.Select(m => m.To).Distinct().Count());
        Assert.DoesNotContain(mail.Sent, m => m.To == gone);
        var listA = mail.Sent.Single(m => m.To == a);
        Assert.Contains(tokenA, listA.Html); Assert.DoesNotContain(tokenB, listA.Html);
        Assert.DoesNotContain(NewsletterService.TestPrefix, listA.Subject);
        Assert.All(mail.Sent, m => Assert.NotNull(m.UnsubscribeUrl));

        detail = await Body(await admin.GetAsync($"/api/admin/newsletters/{id}"));
        Assert.Equal("sent", detail.GetProperty("issue").GetProperty("status").GetString());
        Assert.Equal(0, detail.GetProperty("pending").GetInt32());
        Assert.True(detail.GetProperty("locked").GetBoolean());

        // sent: cannot be sent again, edited or deleted
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/api/admin/newsletters/{id}/send", new { confirm = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/admin/newsletters/{id}", new { name = "x", content = NewsletterContent.Welcome() })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync($"/api/admin/newsletters/{id}")).StatusCode);
    }

    [Fact]
    public async Task The_daily_limit_pauses_the_send_and_a_resume_continues_without_mailing_anyone_twice()
    {
        var (f, mail) = Site_();
        using var __ = f;
        var admin = await AdminAsync(f);
        var a = Unique("limit");
        await SubscriberAsync(f.CreateClient(), a, "רון");
        var id = (await Body(await admin.PostAsJsonAsync("/api/admin/newsletters", new { from = "blank" }))).GetProperty("id").GetGuid();
        (await admin.PostAsJsonAsync($"/api/admin/newsletters/{id}/test", new { emails = new[] { a } })).EnsureSuccessStatusCode();

        // a tight limit: only part of the list goes out, and the mailing pauses with a note
        var sentToday = await DbAsync(f, db => db.NewsletterDeliveries.CountAsync(d => d.At > DateTime.UtcNow.AddHours(-24) && d.Status != "failed"));
        var limited = f.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            { ["PORTALX_NEWSLETTER_DAILY_LIMIT"] = (sentToday + 3).ToString() })));
        var limitedAdmin = await AdminAsync(limited);
        var pending = (await Body(await limitedAdmin.GetAsync($"/api/admin/newsletters/{id}"))).GetProperty("pending").GetInt32();
        mail.Sent.Clear();
        (await limitedAdmin.PostAsJsonAsync($"/api/admin/newsletters/{id}/send", new { confirm = pending })).EnsureSuccessStatusCode();
        await limited.Services.GetRequiredService<NewsletterRunner>().Last!;
        Assert.Equal(Math.Min(3, pending), mail.Sent.Count);
        var paused = await Body(await limitedAdmin.GetAsync($"/api/admin/newsletters/{id}"));
        if (pending > 3)
        {
            Assert.Equal("paused", paused.GetProperty("issue").GetProperty("status").GetString());
            Assert.Contains("מכסה היומית",paused.GetProperty("issue").GetProperty("statusNote").GetString());
        }

        // resume with the normal limit: the rest, and nobody from the first part again
        var first = mail.Sent.Select(m => m.To).ToHashSet();
        var left = (await Body(await admin.GetAsync($"/api/admin/newsletters/{id}"))).GetProperty("pending").GetInt32();
        Assert.Equal(pending - first.Count, left);
        if (left > 0)
        {
            (await admin.PostAsJsonAsync($"/api/admin/newsletters/{id}/send", new { confirm = left })).EnsureSuccessStatusCode();
            await f.Services.GetRequiredService<NewsletterRunner>().Last!;
        }
        Assert.Equal(pending, mail.Sent.Count);
        Assert.Equal(pending, mail.Sent.Select(m => m.To).Distinct().Count());
    }

    [Fact]
    public async Task Saving_a_change_cancels_the_earlier_test_and_the_admin_api_is_closed_to_visitors()
    {
        var (f, _) = Site_();
        using var __ = f;
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/api/admin/newsletters")).StatusCode);

        var admin = await AdminAsync(f);
        var http = f.CreateClient();
        var a = Unique("edit");
        await SubscriberAsync(http, a, "דן");
        var id = (await Body(await admin.PostAsJsonAsync("/api/admin/newsletters", new { from = "blank" }))).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/admin/newsletters/{id}/test", new { emails = new[] { a } })).StatusCode);
        Assert.True((await Body(await admin.GetAsync($"/api/admin/newsletters/{id}"))).GetProperty("tested").GetBoolean());

        var c = NewsletterContent.Blank();
        c.Subject = "נושא אחר";
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/newsletters/{id}", new { name = "טיוטה", content = c })).StatusCode);
        Assert.False((await Body(await admin.GetAsync($"/api/admin/newsletters/{id}"))).GetProperty("tested").GetBoolean());

        c.Cta.Url = "javascript:alert(1)";
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/admin/newsletters/{id}", new { name = "טיוטה", content = c })).StatusCode);

        // more than three test addresses are refused
        var many = await admin.PostAsJsonAsync($"/api/admin/newsletters/{id}/test", new { emails = new[] { "1@x.org", "2@x.org", "3@x.org", "4@x.org" } });
        Assert.Equal(HttpStatusCode.BadRequest, many.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/admin/newsletters/{id}")).StatusCode);
    }
}

/// <summary>The shared test database holds thousands of subscribers from other tests: no delay per message here.</summary>
public sealed class FastEmailSender : IEmailSender
{
    private readonly object _gate = new();
    public List<EmailMessage> Sent { get; } = new();
    public Task<bool> IsAvailableAsync(CancellationToken ct = default) => Task.FromResult(true);
    public Task<string> SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        lock (_gate) Sent.Add(message);
        return Task.FromResult("msg_" + Guid.NewGuid().ToString("N")[..10]);
    }
}
