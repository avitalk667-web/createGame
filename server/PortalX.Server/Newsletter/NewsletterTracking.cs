using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Referrals;

namespace PortalX.Server.Newsletter;

/// <summary>What one click asks for: the request's own signs, used only to tell people from link scanners.</summary>
public sealed record NewsletterClickInfo(string Method, string? UserAgent, string? Purpose);

/// <summary>Where to send the browser, and the purchase-attribution key to place in it (a human click of a real email only).</summary>
public sealed record NewsletterClickResult(string Target, string? AttributionToken);

/// <summary>
/// Click tracking of the "סודות הפורטל" mailings. Every link of an email points to
/// <c>/newsletter/click/{token}.{slot}</c>: the token is random (144 bits, stored only as a hash, naming no address) and
/// identifies that one email; the slot picks one of the mailing's links, whose destination the server wrote itself from
/// the saved mailing. Nothing in the address can choose where the browser goes, so there is no open redirect.
///
/// A click is recorded and the browser is sent on; when recording fails the browser is still sent on. Clicks that look
/// like mail-security scanners are kept but marked, and never counted as people.
/// </summary>
public sealed class NewsletterTracking(PortalDbContext db, ILogger<NewsletterTracking> logger)
{
    public const string ClickPath = "/newsletter/click/";
    /// <summary>The browser cookie that ties a checkout to the click before it (HttpOnly, 7 days).</summary>
    public const string AttributionCookie = "px_nl";
    /// <summary>A purchase counts for a mailing only when its checkout starts within this time after the click.</summary>
    public static readonly TimeSpan AttributionWindow = TimeSpan.FromDays(7);
    /// <summary>A click this soon after the email was sent is a scanner opening it on arrival, not a reader.</summary>
    public static readonly TimeSpan TooFast = TimeSpan.FromSeconds(10);
    /// <summary>This many different links of one email within <see cref="BurstWindow"/>: a scanner opening every link.</summary>
    public const int BurstLinks = 3;
    public static readonly TimeSpan BurstWindow = TimeSpan.FromSeconds(5);
    /// <summary>The same link of the same email again within this time is the same click sent twice (double click, retry).</summary>
    public static readonly TimeSpan Repeat = TimeSpan.FromSeconds(3);

    /// <summary>Signs of link scanners, link previews and scripts in the browser name (lower case).</summary>
    private static readonly string[] ScannerAgents =
    [
        "bot", "crawl", "spider", "slurp", "preview", "scan", "proofpoint", "mimecast", "barracuda", "forcepoint", "trendmicro",
        "symantec", "sophos", "fortiguard", "cloudmark", "messagelabs", "safelinks", "urldefense", "virustotal", "urlscan",
        "headless", "phantomjs", "python", "curl", "wget", "go-http-client", "java/", "okhttp", "libwww", "httpclient", "axios",
        "node-fetch", "facebookexternalhit", "whatsapp", "telegram", "discord", "skypeuripreview", "outlook-ios-linkpreview",
    ];

    public static string NewToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(18)).Replace('+', '-').Replace('/', '_');

    public static string Url(string siteUrl, string token, int slot) => $"{siteUrl.TrimEnd('/')}{ClickPath}{token}.{slot}";

    // ---------------------------------------------------------------- the links of a mailing

    /// <summary>One link an email can carry: where it sits, what it leads to, its label and its destination.</summary>
    public sealed record Planned(string Kind, string Category, string Label, string Destination);

    /// <summary>"game" for a game page, "catalog" for the site's home (the games catalog), "other" for anything else.</summary>
    public static string CategoryOf(string url)
    {
        var path = url.Split('?', '#')[0];
        if (path.StartsWith("/games/") && path.Length > "/games/".Length) return "game";
        if (path is "/" or "" or "/games") return "catalog";
        return "other";
    }

    /// <summary>
    /// The links a mailing's content puts in an email. New kinds of buttons are added here (and in the template) without
    /// any change to the tables: a link is just a kind, a label and a destination.
    /// </summary>
    public static List<Planned> Plan(NewsletterContent c)
    {
        var list = new List<Planned>();
        if (c.Links.Show)
        {
            list.Add(new("game", "game", Short(c.Links.GameLabel), "personal:game:" + c.Links.GameId));
            list.Add(new("site", "catalog", Short(c.Links.SiteLabel), "personal:site"));
        }
        if (c.Cta.Show) list.Add(new("cta", CategoryOf(c.Cta.Url), Short(c.Cta.Label), c.Cta.Url.Trim()));
        list.Add(new("home", "catalog", "אתר PORTAL-X (בתחתית המייל)", "/"));
        return list;
    }

    private static string Short(string? s) { s = (s ?? "").Trim(); return s.Length > 120 ? s[..120] : s; }

    /// <summary>
    /// Writes the mailing's links (once per kind). While it is a draft a link follows the latest content; once the
    /// send has started the links are fixed, as the content is.
    /// </summary>
    public async Task<Dictionary<string, NewsletterLink>> EnsureLinksAsync(NewsletterIssue issue, NewsletterContent c)
    {
        var existing = await db.NewsletterLinks.Where(l => l.IssueId == issue.Id).ToListAsync();
        var next = existing.Count == 0 ? 1 : existing.Max(l => l.Slot) + 1;
        foreach (var p in Plan(c))
        {
            var link = existing.FirstOrDefault(l => l.Kind == p.Kind);
            if (link == null)
            {
                link = new NewsletterLink { Id = Guid.NewGuid(), IssueId = issue.Id, Slot = next++, Kind = p.Kind, CreatedAt = DateTime.UtcNow };
                db.NewsletterLinks.Add(link);
                existing.Add(link);
            }
            else if (issue.Status != "draft") continue;
            link.Category = p.Category;
            link.Label = p.Label;
            link.Destination = p.Destination;
        }
        await db.SaveChangesAsync();
        return existing.ToDictionary(l => l.Kind);
    }

    /// <summary>
    /// A new tracking key for one email; returns the kind → tracked address of each of its links, or null when it
    /// could not be saved (the email then goes out with its plain links rather than not at all).
    /// </summary>
    public async Task<Dictionary<string, string>?> NewTrackerAsync(Guid issueId, long? deliveryId, string? testEmail,
        Dictionary<string, NewsletterLink> links, string siteUrl)
    {
        var token = NewToken();
        var tracker = new NewsletterTracker
        {
            Id = Guid.NewGuid(), IssueId = issueId, DeliveryId = deliveryId, IsTest = deliveryId == null, TestEmail = deliveryId == null ? testEmail : null,
            TokenHash = RoomService.Hash(token), CreatedAt = DateTime.UtcNow,
        };
        db.NewsletterTrackers.Add(tracker);
        try { await db.SaveChangesAsync(); }
        catch (Exception ex)
        {
            logger.LogWarning("Newsletter tracker not saved ({Type})", ex.GetType().Name);
            db.Entry(tracker).State = EntityState.Detached;
            return null;
        }
        return links.Values.ToDictionary(l => l.Kind, l => Url(siteUrl, token, l.Slot));
    }

    // ---------------------------------------------------------------- the click

    /// <summary>Why a request looks automatic, or null for what looks like a person.</summary>
    public static string? AutomatedReason(NewsletterClickInfo info)
    {
        if (string.Equals(info.Method, "HEAD", StringComparison.OrdinalIgnoreCase)) return "head";
        if (info.Purpose != null && info.Purpose.Contains("prefetch", StringComparison.OrdinalIgnoreCase)) return "prefetch";
        var ua = (info.UserAgent ?? "").ToLowerInvariant();
        if (ua.Length == 0 || !ua.Contains("mozilla/") || ScannerAgents.Any(ua.Contains)) return "agent";
        return null;
    }

    private static (string Token, int Slot)? Parse(string raw)
    {
        var dot = raw.LastIndexOf('.');
        if (dot != 24 || !int.TryParse(raw.AsSpan(dot + 1), out var slot) || slot is < 1 or > 99) return null;
        var token = raw[..dot];
        return token.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_') ? (token, slot) : null;
    }

    /// <summary>
    /// Records one click and says where to send the browser. Never throws: an unknown or broken address goes to the
    /// home page, and a failure while recording still sends the reader to the link's destination.
    /// </summary>
    public async Task<NewsletterClickResult> ClickAsync(string raw, NewsletterClickInfo info, DateTime now)
    {
        string target = "/";
        NewsletterTracker? tracker;
        NewsletterLink? link;
        NewsletterDelivery? delivery = null;
        try
        {
            if (Parse(raw) is not { } p) return new("/", null);
            var hash = RoomService.Hash(p.Token);
            tracker = await db.NewsletterTrackers.AsNoTracking().FirstOrDefaultAsync(t => t.TokenHash == hash);
            if (tracker == null) return new("/", null);
            link = await db.NewsletterLinks.AsNoTracking().FirstOrDefaultAsync(l => l.IssueId == tracker.IssueId && l.Slot == p.Slot);
            if (link == null) return new("/", null);
            if (tracker.DeliveryId is { } did) delivery = await db.NewsletterDeliveries.AsNoTracking().FirstOrDefaultAsync(d => d.Id == did);
            target = await TargetAsync(link, tracker.TestEmail ?? delivery?.Email);
        }
        catch (Exception ex)
        {
            logger.LogWarning("Newsletter click not resolved ({Type})", ex.GetType().Name);
            return new(target, null);
        }

        try
        {
            // the same click sent twice is one click
            var since = now - Repeat;
            if (await db.NewsletterClickEvents.AnyAsync(c => c.TrackerId == tracker.Id && c.LinkId == link.Id && c.ClickedAt > since && c.ClickedAt <= now))
                return new(target, null);

            var reason = AutomatedReason(info);
            if (reason == null && delivery is { Status: "sent" } && now - delivery.At < TooFast && now >= delivery.At) reason = "too-fast";
            var burstFrom = now - BurstWindow;
            var recent = await db.NewsletterClickEvents.Where(c => c.TrackerId == tracker.Id && c.ClickedAt > burstFrom && c.ClickedAt <= now).ToListAsync();
            if (recent.Select(c => c.LinkId).Append(link.Id).Distinct().Count() >= BurstLinks)
            {
                reason ??= "burst";
                foreach (var c in recent.Where(c => !c.IsAutomated)) { c.IsAutomated = true; c.AutomatedReason = "burst"; c.AttributionHash = null; }
            }

            string? attribution = tracker.IsTest || reason != null ? null : NewToken();
            db.NewsletterClickEvents.Add(new NewsletterClickEvent
            {
                IssueId = tracker.IssueId, TrackerId = tracker.Id, DeliveryId = tracker.DeliveryId, LinkId = link.Id, ClickedAt = now,
                UserAgent = info.UserAgent is { Length: > 256 } ua ? ua[..256] : info.UserAgent,
                IsTest = tracker.IsTest, IsAutomated = reason != null, AutomatedReason = reason,
                AttributionHash = attribution == null ? null : RoomService.Hash(attribution),
            });
            await db.SaveChangesAsync();
            return new(target, attribution);
        }
        catch (Exception ex)
        {
            // the reader still reaches the link
            logger.LogWarning("Newsletter click not recorded ({Type})", ex.GetType().Name);
            db.ChangeTracker.Clear();
            return new(target, null);
        }
    }

    /// <summary>The link's destination: only what the server stored for this mailing, checked again; a personal link is the recipient's own.</summary>
    private async Task<string> TargetAsync(NewsletterLink link, string? email)
    {
        var d = link.Destination;
        if (d.StartsWith("personal:"))
        {
            var gameId = d.StartsWith("personal:game:") ? d["personal:game:".Length..] : null;
            if (gameId != null && !NewsletterContent.GameId().IsMatch(gameId)) gameId = null;
            var own = email == null ? null : await db.ReferralLinks.AsNoTracking()
                .FirstOrDefaultAsync(l => l.Email == email && l.Status == ReferralLinkStatus.Active && l.DisabledAt == null);
            if (own == null) return gameId != null ? $"/games/{gameId}" : "/";
            var url = ReferralService.LinkUrl(own, "");
            return gameId != null ? $"{url}?to={Uri.EscapeDataString(gameId)}" : url;
        }
        return NewsletterContent.IsSitePath(d) || NewsletterContent.IsHttps(d) ? d : "/";
    }

    public static CookieOptions AttributionCookieOptions(HttpRequest request) => new()
    {
        HttpOnly = true,
        Secure = request.IsHttps,
        SameSite = SameSiteMode.Lax,
        Path = "/",
        MaxAge = AttributionWindow,
    };

    // ---------------------------------------------------------------- purchases

    /// <summary>
    /// Ties a new order to the mailing click whose key this browser carries: a human click of a real email, within
    /// <see cref="AttributionWindow"/> before the checkout started. Nothing else counts (not an address that once
    /// clicked). Never throws and never touches the order.
    /// </summary>
    public async Task AttributeAsync(Guid orderId, string? cookie, DateTime now)
    {
        if (string.IsNullOrWhiteSpace(cookie) || cookie.Length != 24) return;
        try
        {
            var hash = RoomService.Hash(cookie);
            var since = now - AttributionWindow;
            var click = await db.NewsletterClickEvents.AsNoTracking()
                .Where(c => c.AttributionHash == hash && !c.IsTest && !c.IsAutomated && c.ClickedAt > since && c.ClickedAt <= now)
                .OrderByDescending(c => c.ClickedAt).FirstOrDefaultAsync();
            if (click == null || await db.NewsletterOrderAttributions.AnyAsync(a => a.OrderId == orderId)) return;
            db.NewsletterOrderAttributions.Add(new NewsletterOrderAttribution
            {
                OrderId = orderId, IssueId = click.IssueId, ClickId = click.Id, DeliveryId = click.DeliveryId, ClickedAt = click.ClickedAt, AttributedAt = now,
            });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogWarning("Newsletter purchase not attributed ({Type})", ex.GetType().Name);
            db.ChangeTracker.Clear();
        }
    }
}
