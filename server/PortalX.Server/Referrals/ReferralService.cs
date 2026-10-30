using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Mail;

namespace PortalX.Server.Referrals;

public sealed record CreateLinkRequest(string? FirstName, string? LastName, string? Email, bool MarketingConsent, bool AcceptTerms);

/// <summary>What the visitor sees: the link itself and whether the email went out — never anything about purchases.</summary>
public sealed record LinkReply(bool Ok, string Code, string Message, string? Token = null, string? Url = null, string? FirstName = null,
    bool Existing = false, string? EmailStatus = null, string? EmailMessage = null);

/// <summary>
/// Personal marketing links (affiliate spec): one link per email address, shown at once and sent through the site's Gmail
/// sender; and the "same visit" attribution of purchases. No reward is paid and buyers get no discount.
/// </summary>
public sealed partial class ReferralService(
    PortalDbContext db, IEmailSender sender, SiteOptions site, ConsentRecorder consents, UnsubscribeLinks links, CampaignContent campaign,
    ILogger<ReferralService> logger)
{
    public const string ConsentVersion = "2026-10-ref-v1";
    public const string ConsentText = "אני מסכים/ה לקבל מיילים שיווקיים ועדכונים מ-PORTAL X בנוגע למשחקים חדשים, מבצעים, הטבות, קופונים ותכנים נוספים. ידוע לי שניתן לבטל את ההסכמה בכל עת.";
    public const string TermsText = "אני מסכים/ה לתנאי השימוש והתקנון של האתר.";
    public const string Source = "personal-link";
    /// <summary>The visit's session cookie: a random visit token only (HttpOnly, no expiry date — it ends with the browser session).</summary>
    public const string VisitCookie = "px_ref";
    /// <summary>A visit counts for at most this long after its last personal-link click, even if the browser keeps its session.</summary>
    public static readonly TimeSpan VisitLifetime = TimeSpan.FromHours(24);
    /// <summary>The same link is mailed at most once in this time.</summary>
    public static readonly TimeSpan ResendGap = TimeSpan.FromMinutes(2);

    public const string SentMessage = "הקישור נשלח גם למייל שהזנת. כדאי לבדוק גם בתיקיית הספאם.";
    public const string FailedMessage = "הקישור נוצר, אבל לא הצלחנו לשלוח אותו למייל כרגע. אפשר להעתיק אותו מכאן או לנסות לשלוח שוב.";
    public const string UncertainMessage = "לא ברור אם המייל נשלח (החיבור נקטע). בדקו בעוד כמה דקות את תיבת הדואר, ואם לא הגיע — נסו לשלוח שוב.";
    public const string UnavailableMessage = "הקישור נוצר, אבל שליחת מיילים עדיין לא זמינה באתר. אפשר להעתיק אותו מכאן.";

    [GeneratedRegex(@"^\p{L}[\p{L}\p{M} '\-׳״.]{0,39}$")]
    private static partial Regex NameShape();

    [GeneratedRegex(@"^[A-Za-z0-9_-]{16,32}$")]
    private static partial Regex TokenShape();

    /// <summary>A name of letters (with spaces, hyphens, apostrophes), 1–40 characters — or null.</summary>
    public static string? CleanName(string? name)
    {
        var n = string.Join(' ', (name ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        return n.Length is >= 1 and <= 40 && NameShape().IsMatch(n) ? n : null;
    }

    /// <summary>128 random bits, URL-safe: says nothing about the owner and cannot be guessed or counted.</summary>
    public static string NewToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string LinkUrl(ReferralLink l, string siteUrl) => $"{siteUrl.TrimEnd('/')}/r/{l.Token}";

    // ------------------------------------------------------------------ creating a link

    public async Task<(LinkReply Reply, int Status)> CreateAsync(CreateLinkRequest req, string requestSiteUrl)
    {
        var first = CleanName(req.FirstName);
        var last = CleanName(req.LastName);
        if (first == null || last == null)
            return (new(false, "bad-name", "יש למלא שם פרטי ושם משפחה (אותיות בלבד, עד 40 תווים)."), 400);
        var email = ResultsEmailService.NormalizeEmail(req.Email);
        if (email == null) return (new(false, "bad-email", ResultsEmailService.BadEmailMessage), 400);
        if (!req.MarketingConsent)
            return (new(false, "consent-required", "כדי ליצור קישור אישי יש לאשר קבלת מיילים שיווקיים מ־PORTAL X."), 400);
        if (!req.AcceptTerms) return (new(false, "terms-required", "כדי ליצור קישור אישי יש לאשר את תנאי השימוש והתקנון."), 400);

        var siteUrl = site.SiteUrl ?? requestSiteUrl;
        var now = DateTime.UtcNow;
        var link = await db.ReferralLinks.FirstOrDefaultAsync(l => l.Email == email);
        var existing = link != null;
        if (link == null)
        {
            link = new ReferralLink
            {
                Id = Guid.NewGuid(), Token = NewToken(), FirstName = first, LastName = last, Email = email,
                Status = ReferralLinkStatus.Active, CreatedAt = now, UpdatedAt = now, Source = Source,
                MarketingConsent = true, ConsentAt = now, ConsentVersion = ConsentVersion, ConsentText = ConsentText, TermsAcceptedAt = now,
            };
            db.ReferralLinks.Add(link);
            try
            {
                await db.SaveChangesAsync();
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                // the same address was submitted twice at the same moment: the first link stands
                db.ChangeTracker.Clear();
                link = await db.ReferralLinks.FirstAsync(l => l.Email == email);
                existing = true;
            }
        }
        if (link.Status == ReferralLinkStatus.Disabled)
            return (new(false, "link-disabled", $"לא ניתן להציג את הקישור לכתובת הזאת. לפרטים אפשר לפנות אלינו: {site.ContactEmail}"), 409);

        // the explicit tick of this form is recorded every time (a revoked address becomes active only like this)
        await consents.GrantAsync(email, Source, null, ConsentVersion, ConsentText, now);
        if (existing)
        {
            await db.ReferralLinks.Where(l => l.Id == link.Id).ExecuteUpdateAsync(s => s
                .SetProperty(l => l.MarketingConsent, true).SetProperty(l => l.ConsentAt, now)
                .SetProperty(l => l.ConsentVersion, ConsentVersion).SetProperty(l => l.ConsentText, ConsentText)
                .SetProperty(l => l.TermsAcceptedAt, now).SetProperty(l => l.UpdatedAt, now));
            logger.LogInformation("Personal link {Link} shown again for an existing address", link.Id);
            // the same link as before — never a second one; sending it again is the visitor's choice
            return (new(true, "existing", "לכתובת הזאת כבר יש קישור אישי — הנה הוא. אפשר לשלוח אותו שוב למייל.",
                link.Token, LinkUrl(link, siteUrl), first, Existing: true), 200);
        }
        logger.LogInformation("Personal link {Link} created", link.Id);
        var (status, message) = await SendAsync(link, first, siteUrl, now);
        return (new(true, "created", "הקישור האישי שלך נוצר בהצלחה. אפשר להעתיק אותו ולשתף עם חברים ומכרים.",
            link.Token, LinkUrl(link, siteUrl), first, false, status, message), 200);
    }

    /// <summary>"Send the link again": the same link, to its own address only, at most once in <see cref="ResendGap"/>.</summary>
    public async Task<(LinkReply Reply, int Status)> ResendAsync(string? token, string requestSiteUrl)
    {
        if (string.IsNullOrEmpty(token) || !TokenShape().IsMatch(token)) return (new(false, "no-link", "הקישור לא נמצא."), 404);
        var link = await db.ReferralLinks.AsNoTracking().FirstOrDefaultAsync(l => l.Token == token && l.Status == ReferralLinkStatus.Active);
        if (link == null) return (new(false, "no-link", "הקישור לא נמצא."), 404);
        var now = DateTime.UtcNow;
        var (status, message) = await SendAsync(link, link.FirstName, site.SiteUrl ?? requestSiteUrl, now);
        if (status == "too-soon") return (new(false, "too-soon", message), 429);
        return (new(status == "sent", status, message, link.Token, LinkUrl(link, site.SiteUrl ?? requestSiteUrl), EmailStatus: status, EmailMessage: message), 200);
    }

    /// <summary>
    /// Sends the link through the site's sender. "sent" only with the provider's confirmation (its message id).
    /// The send is claimed atomically, so two clicks never mail the same link twice within the gap.
    /// </summary>
    private async Task<(string Status, string Message)> SendAsync(ReferralLink link, string greetingName, string siteUrl, DateTime now)
    {
        if (!await sender.IsAvailableAsync())
        {
            await db.ReferralLinks.Where(l => l.Id == link.Id).ExecuteUpdateAsync(s => s
                .SetProperty(l => l.LastEmailStatus, "not-configured").SetProperty(l => l.LastEmailError, "not-configured"));
            return ("not-configured", UnavailableMessage);
        }
        var gap = now - ResendGap;
        var claimed = await db.ReferralLinks
            // the gap applies after a send that went out (or is going out); after a failure the visitor may retry at once
            .Where(l => l.Id == link.Id && (l.LastEmailAt == null || l.LastEmailAt < gap || (l.LastEmailStatus != "sent" && l.LastEmailStatus != "sending")))
            .ExecuteUpdateAsync(s => s.SetProperty(l => l.LastEmailAt, now).SetProperty(l => l.LastEmailStatus, "sending"));
        if (claimed == 0) return ("too-soon", "הקישור נשלח לפני רגע. אפשר לנסות שוב בעוד כמה דקות.");

        var consent = await db.MarketingConsents.AsNoTracking().FirstOrDefaultAsync(c => c.Email == link.Email && c.Status == ConsentStatus.Active);
        var model = new ReferralEmailModel(greetingName, LinkUrl(link, siteUrl), siteUrl.TrimEnd('/'), site.ContactEmail,
            consent == null ? null : await links.UrlAsync(consent, siteUrl), campaign);
        var message = new EmailMessage(link.Email, ReferralEmailTemplate.Subject, ReferralEmailTemplate.Html(model), ReferralEmailTemplate.Text(model), model.UnsubscribeUrl);
        string? error = null, messageId = null;
        var uncertain = false;
        for (var i = 0; i < 2; i++)
        {
            try
            {
                messageId = await sender.SendAsync(message);
                error = null;
                break;
            }
            catch (EmailSendException ex)
            {
                error = ex.Code;
                uncertain = ex.Uncertain;
                if (!ex.Transient || ex.Uncertain || ex.Code is "quota" or "google-unreachable") break;
                await Task.Delay(400);
            }
        }
        var done = error == null && !string.IsNullOrEmpty(messageId);
        var status = done ? "sent" : uncertain ? "uncertain" : "failed";
        await db.ReferralLinks.Where(l => l.Id == link.Id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.LastEmailStatus, status)
            .SetProperty(l => l.LastEmailAt, DateTime.UtcNow)
            .SetProperty(l => l.LastEmailError, done ? null : error ?? "no-message-id")
            .SetProperty(l => l.LastEmailMessageId, l => done ? messageId : l.LastEmailMessageId)
            .SetProperty(l => l.EmailsSent, l => done ? l.EmailsSent + 1 : l.EmailsSent));
        // the log names the link, never the address
        if (done) logger.LogInformation("Personal link {Link} emailed", link.Id);
        else logger.LogWarning("Personal link {Link} email not confirmed: {Error}", link.Id, error);
        return done ? ("sent", SentMessage) : uncertain ? ("uncertain", UncertainMessage) : ("failed", FailedMessage);
    }

    // ------------------------------------------------------------------ the visit (attribution)

    /// <summary>
    /// A personal link was opened. Returns the visit token for the session cookie, or null when the link is unknown or
    /// disabled. The same visit opening another valid link now points to that one (last click).
    /// </summary>
    public async Task<string?> OpenVisitAsync(string? linkToken, string? visitToken)
    {
        if (string.IsNullOrEmpty(linkToken) || !TokenShape().IsMatch(linkToken)) return null;
        var linkId = await db.ReferralLinks.Where(l => l.Token == linkToken && l.Status == ReferralLinkStatus.Active).Select(l => (Guid?)l.Id).FirstOrDefaultAsync();
        if (linkId == null) return null;
        var now = DateTime.UtcNow;
        if (!string.IsNullOrEmpty(visitToken) && visitToken.Length <= 64)
        {
            var hash = RoomService.Hash(visitToken);
            var updated = await db.ReferralVisits.Where(v => v.TokenHash == hash && v.LastClickAt > now - VisitLifetime)
                .ExecuteUpdateAsync(s => s.SetProperty(v => v.ReferralLinkId, linkId.Value).SetProperty(v => v.LastClickAt, now));
            if (updated > 0) return visitToken;
        }
        var token = RoomService.NewToken();
        db.ReferralVisits.Add(new ReferralVisit { Id = Guid.NewGuid(), TokenHash = RoomService.Hash(token), ReferralLinkId = linkId.Value, CreatedAt = now, LastClickAt = now });
        await db.SaveChangesAsync();
        return token;
    }

    /// <summary>The link this visit came through — only while the visit lasts and the link is still active.</summary>
    public async Task<Guid?> ResolveVisitAsync(string? visitToken)
    {
        if (string.IsNullOrEmpty(visitToken) || visitToken.Length > 64) return null;
        var hash = RoomService.Hash(visitToken);
        var since = DateTime.UtcNow - VisitLifetime;
        return await db.ReferralVisits.Where(v => v.TokenHash == hash && v.LastClickAt > since)
            .Join(db.ReferralLinks.Where(l => l.Status == ReferralLinkStatus.Active), v => v.ReferralLinkId, l => l.Id, (v, l) => (Guid?)l.Id)
            .FirstOrDefaultAsync();
    }

    public static CookieOptions VisitCookieOptions(HttpRequest request) => new()
    {
        // no MaxAge/Expires: a session cookie, gone when the browser session ends
        HttpOnly = true,
        Secure = request.IsHttps,
        SameSite = SameSiteMode.Lax,
        Path = "/",
        IsEssential = true,
    };

    /// <summary>
    /// Whether a paid order still counts for its link. Decided on the server from the stored order and link: a purchase
    /// by the link's owner (same normalized address) is kept in sales but excluded from the link's numbers.
    /// </summary>
    public static string? ExclusionFor(string? orderEmail, string linkEmail) =>
        ResultsEmailService.NormalizeEmail(orderEmail) is { } buyer && buyer == linkEmail ? "self-purchase" : null;
}
