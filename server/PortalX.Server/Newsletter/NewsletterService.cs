using System.Collections.Concurrent;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Mail;
using PortalX.Server.Referrals;

namespace PortalX.Server.Newsletter;

/// <summary>How fast the list is mailed. Gmail allows about 500 recipients a day on a regular account (2,000 on Workspace).</summary>
public sealed class NewsletterOptions
{
    /// <summary>At most this many newsletter emails in any 24 hours; the send pauses there and is resumed later.</summary>
    public int DailyLimit { get; init; } = 400;
    /// <summary>The pause between two emails, so the sending account is never flooded.</summary>
    public TimeSpan Pause { get; init; } = TimeSpan.FromMilliseconds(1500);

    public static NewsletterOptions FromConfig(IConfiguration c) => new()
    {
        DailyLimit = int.TryParse(c["PORTALX_NEWSLETTER_DAILY_LIMIT"], out var d) && d > 0 ? d : 400,
        Pause = TimeSpan.FromMilliseconds(int.TryParse(c["Newsletter:PauseMs"], out var p) && p >= 0 ? p : 1500),
    };
}

public sealed record NewsletterSaveRequest(string? Name, NewsletterContent? Content);
public sealed record NewsletterCreateRequest(string? From, Guid? CopyOf);
public sealed record NewsletterPreviewRequest(NewsletterContent? Content, string? Email);
public sealed record NewsletterTestRequest(List<string>? Emails);
public sealed record NewsletterSendRequest(int? Confirm);

/// <summary>
/// The "סודות הפורטל" mailings: drafts, previews, test sends and the send to the list. Each email is built for its own
/// recipient on the server — their name, their own personal links and their own signed unsubscribe link — and goes only
/// to an address whose marketing consent is active at the moment it is sent. One message per person: never a group
/// message, so nobody ever sees another person's links or address.
/// </summary>
public sealed class NewsletterService(PortalDbContext db, UnsubscribeLinks links, SiteOptions site, IEmailSender sender,
    NewsletterOptions options, NewsletterRunner runner, NewsletterTracking tracking)
{
    public const string TestPrefix = "[בדיקה] ";
    /// <summary>Gmail cuts an email longer than about 102KB ("[ההודעה נחתכה]"): warn well before that.</summary>
    public const int ClipWarnBytes = 90_000;

    private static readonly string[] Done = ["sent", "uncertain", "sending"];

    private NewsletterSite Site(string siteUrl) => new(siteUrl.TrimEnd('/'), site.ContactEmail);

    /// <summary>The personal referral link of an address, if it has an active one.</summary>
    private Task<ReferralLink?> LinkAsync(string email) =>
        db.ReferralLinks.AsNoTracking().FirstOrDefaultAsync(l => l.Email == email && l.Status == ReferralLinkStatus.Active && l.DisabledAt == null);

    /// <summary>The page the "game" personal link opens: the link itself, told which product page to land on.</summary>
    public static string GameLink(ReferralLink link, string gameId, string siteUrl) => $"{ReferralService.LinkUrl(link, siteUrl)}?to={Uri.EscapeDataString(gameId)}";

    /// <summary>Everything personal in one email, read from this address's own rows only.</summary>
    public async Task<NewsletterRecipient> RecipientAsync(string email, NewsletterContent c, string siteUrl, MarketingConsent? consent)
    {
        var link = await LinkAsync(email);
        var unsubscribe = consent is { Status: ConsentStatus.Active } ? await links.UrlAsync(consent, siteUrl) : null;
        return new NewsletterRecipient(email, link?.FirstName,
            link == null ? null : GameLink(link, c.Links.GameId, siteUrl),
            link == null ? null : ReferralService.LinkUrl(link, siteUrl),
            unsubscribe);
    }

    /// <summary>The look of a mailing for someone with every personal part (sample links, no real ones).</summary>
    public static NewsletterRecipient Sample(string siteUrl) =>
        new("example@example.com", "ישראל", $"{siteUrl.TrimEnd('/')}/r/EXAMPLE?to=hanukkah-oil", $"{siteUrl.TrimEnd('/')}/r/EXAMPLE", null);

    public async Task<object> PreviewAsync(NewsletterContent c, string? email, string siteUrl)
    {
        var e = MailingAdmin.Normalize(email);
        NewsletterRecipient r;
        string who;
        if (e == null) { r = Sample(siteUrl); who = "נמען לדוגמה (שם וקישורים לדוגמה בלבד)"; }
        else
        {
            var consent = await db.MarketingConsents.AsNoTracking().FirstOrDefaultAsync(x => x.Email == e);
            r = await RecipientAsync(e, c, siteUrl, consent);
            who = consent?.Status == ConsentStatus.Active ? "נמען ברשימה (הסכמה פעילה)" : "כתובת ללא הסכמה פעילה — לא תקבל את הדיוור";
        }
        var html = NewsletterTemplate.Html(c, r, Site(siteUrl));
        var bytes = Encoding.UTF8.GetByteCount(html);
        return new
        {
            subject = NewsletterTemplate.Subject(c), html, text = NewsletterTemplate.Text(c, r, Site(siteUrl)), bytes,
            who, hasGameLink = r.GameLinkUrl != null, hasSiteLink = r.SiteLinkUrl != null, hasUnsubscribe = r.UnsubscribeUrl != null,
            warning = bytes > ClipWarnBytes ? "המייל ארוך מדי: Gmail עלול לקצר אותו. כדאי לקצר טקסט או להסתיר אזור." : null,
            problem = c.Validate(),
        };
    }

    // ---------------------------------------------------------------- drafts

    private static object Row(NewsletterIssue i, Dictionary<string, int> counts) => new
    {
        i.Id, i.Name, i.Status, i.StatusNote, i.CreatedAt, i.UpdatedAt, i.TestedAt, i.SendStartedAt, i.SendFinishedAt,
        subject = NewsletterContent.FromJson(i.ContentJson).Subject,
        sent = counts.GetValueOrDefault("sent"), failed = counts.GetValueOrDefault("failed"),
        uncertain = counts.GetValueOrDefault("uncertain") + counts.GetValueOrDefault("sending"),
    };

    private async Task<Dictionary<string, int>> CountsAsync(Guid id) =>
        await db.NewsletterDeliveries.Where(d => d.IssueId == id).GroupBy(d => d.Status).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N);

    public async Task<object> ListAsync()
    {
        var issues = await db.NewsletterIssues.AsNoTracking().OrderByDescending(i => i.CreatedAt).Take(200).ToListAsync();
        var rows = new List<object>();
        foreach (var i in issues) rows.Add(Row(i, await CountsAsync(i.Id)));
        return new
        {
            issues = rows,
            audience = await db.MarketingConsents.CountAsync(c => c.Status == ConsentStatus.Active),
            senderReady = await sender.IsAvailableAsync(),
            dailyLimit = options.DailyLimit,
            sentLast24h = await SentLast24hAsync(),
        };
    }

    private Task<int> SentLast24hAsync()
    {
        var since = DateTime.UtcNow.AddHours(-24);
        return db.NewsletterDeliveries.CountAsync(d => d.At > since && d.Status != "failed");
    }

    public async Task<object?> DetailAsync(Guid id)
    {
        var i = await db.NewsletterIssues.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (i == null) return null;
        return new
        {
            issue = Row(i, await CountsAsync(id)),
            content = NewsletterContent.FromJson(i.ContentJson),
            pending = await PendingCountAsync(id),
            running = runner.IsRunning(id),
            tested = i.TestedAt != null && i.TestedAt >= i.UpdatedAt,
            locked = i.Status != "draft",
        };
    }

    public async Task<NewsletterIssue?> CreateAsync(NewsletterCreateRequest req)
    {
        NewsletterContent content;
        string name;
        if (req.From == "copy" && req.CopyOf is { } from)
        {
            var source = await db.NewsletterIssues.AsNoTracking().FirstOrDefaultAsync(x => x.Id == from);
            if (source == null) return null;
            content = NewsletterContent.FromJson(source.ContentJson);
            name = (source.Name + " (עותק)")[..Math.Min(120, source.Name.Length + 7)];
        }
        else if (req.From == "welcome") { content = NewsletterContent.Welcome(); name = "מייל הפתיחה — ברוכים הבאים"; }
        else { content = NewsletterContent.Blank(); name = "דיוור חדש"; }
        var now = DateTime.UtcNow;
        var issue = new NewsletterIssue { Id = Guid.NewGuid(), Name = name, ContentJson = content.ToJson(), Status = "draft", CreatedAt = now, UpdatedAt = now };
        db.NewsletterIssues.Add(issue);
        await db.SaveChangesAsync();
        return issue;
    }

    /// <summary>Saves a draft. Any change cancels the earlier test: the list is mailed only after testing what will go out.</summary>
    public async Task<string?> SaveAsync(Guid id, NewsletterSaveRequest req)
    {
        var i = await db.NewsletterIssues.FirstOrDefaultAsync(x => x.Id == id);
        if (i == null) return "not-found";
        if (i.Status != "draft") return "הדיוור כבר נשלח (או בשליחה) ולכן אי אפשר לשנות אותו. אפשר ליצור עותק.";
        if (req.Content == null) return "חסר תוכן.";
        var problem = req.Content.Validate();
        if (problem != null) return problem;
        var json = req.Content.ToJson();
        var name = string.IsNullOrWhiteSpace(req.Name) ? i.Name : req.Name.Trim()[..Math.Min(120, req.Name.Trim().Length)];
        if (json == i.ContentJson && name == i.Name) return null;
        i.ContentJson = json;
        i.Name = name;
        i.UpdatedAt = DateTime.UtcNow;
        i.TestedAt = null;
        await db.SaveChangesAsync();
        return null;
    }

    public async Task<string?> DeleteAsync(Guid id)
    {
        var i = await db.NewsletterIssues.FirstOrDefaultAsync(x => x.Id == id);
        if (i == null) return "not-found";
        if (i.Status != "draft" || await db.NewsletterDeliveries.AnyAsync(d => d.IssueId == id)) return "אי אפשר למחוק דיוור שכבר נשלח.";
        db.NewsletterIssues.Remove(i);
        await db.SaveChangesAsync();
        return null;
    }

    // ---------------------------------------------------------------- test send

    /// <summary>
    /// Sends the saved draft to 1–3 addresses, each with its own personal parts (as the list would get it), marked
    /// "[בדיקה]". Nothing is recorded as delivered. A successful test of the unchanged draft allows sending to the list.
    /// </summary>
    public async Task<(object Reply, int Status)> TestAsync(Guid id, NewsletterTestRequest req, string siteUrl)
    {
        var i = await db.NewsletterIssues.FirstOrDefaultAsync(x => x.Id == id);
        if (i == null) return (new ApiError("not-found", "הדיוור לא נמצא."), 404);
        var emails = (req.Emails ?? []).Select(MailingAdmin.Normalize).Where(e => e != null).Select(e => e!).Distinct().ToList();
        if (emails.Count is 0 or > 3 || emails.Any(e => e.Length > 254 || !e.Contains('@') || e.Contains(' ')))
            return (new ApiError("bad-email", "יש להזין בין כתובת אחת לשלוש כתובות תקינות."), 400);
        if (!await sender.IsAvailableAsync()) return (new ApiError("not-configured", "שליחת המיילים אינה מחוברת (הגדרות מערכת ← חשבון Gmail)."), 409);
        var c = NewsletterContent.FromJson(i.ContentJson);
        var results = new List<object>();
        var allOk = true;
        // a test email goes through the same click tracking as the list's, marked as a test: its clicks never count
        var trackedLinks = await tracking.EnsureLinksAsync(i, c);
        foreach (var e in emails)
        {
            var consent = await db.MarketingConsents.AsNoTracking().FirstOrDefaultAsync(x => x.Email == e);
            var r = await RecipientAsync(e, c, siteUrl, consent);
            r = r with { Tracked = await tracking.NewTrackerAsync(i.Id, null, e, trackedLinks, siteUrl) };
            try
            {
                await sender.SendAsync(new EmailMessage(e, TestPrefix + NewsletterTemplate.Subject(c),
                    NewsletterTemplate.Html(c, r, Site(siteUrl)), NewsletterTemplate.Text(c, r, Site(siteUrl)), r.UnsubscribeUrl));
                results.Add(new { email = e, ok = true, personalLinks = r.GameLinkUrl != null, unsubscribe = r.UnsubscribeUrl != null });
            }
            catch (EmailSendException ex)
            {
                allOk = false;
                results.Add(new { email = e, ok = false, error = ex.Code });
            }
        }
        if (allOk && i.Status == "draft")
        {
            i.TestedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        return (new { ok = allOk, results }, 200);
    }

    // ---------------------------------------------------------------- send to the list

    /// <summary>Active consents that have not got (or started getting) this mailing; failed ones are tried again.</summary>
    private IQueryable<MarketingConsent> Pending(Guid id) =>
        db.MarketingConsents.AsNoTracking().Where(c => c.Status == ConsentStatus.Active
            && !db.NewsletterDeliveries.Any(d => d.IssueId == id && d.Email == c.Email && Done.Contains(d.Status)));

    public Task<int> PendingCountAsync(Guid id) => Pending(id).CountAsync();

    /// <summary>
    /// Starts (or resumes) the send to the list. It needs a successful test of this exact draft, a connected sender,
    /// and the number of recipients typed by the admin — the same number the server counts right now.
    /// </summary>
    public async Task<(object Reply, int Status)> StartAsync(Guid id, NewsletterSendRequest req, string siteUrl)
    {
        var i = await db.NewsletterIssues.FirstOrDefaultAsync(x => x.Id == id);
        if (i == null) return (new ApiError("not-found", "הדיוור לא נמצא."), 404);
        if (i.Status == "sent") return (new ApiError("already-sent", "הדיוור כבר נשלח לכל הרשימה."), 409);
        if (runner.IsRunning(id)) return (new ApiError("running", "הדיוור כבר בשליחה."), 409);
        if (i.TestedAt == null || i.TestedAt < i.UpdatedAt) return (new ApiError("not-tested", "לפני שליחה לרשימה יש לשלוח מייל בדיקה של הגרסה הנוכחית ולבדוק אותו."), 409);
        var problem = NewsletterContent.FromJson(i.ContentJson).Validate();
        if (problem != null) return (new ApiError("invalid", problem), 400);
        if (!await sender.IsAvailableAsync()) return (new ApiError("not-configured", "שליחת המיילים אינה מחוברת."), 409);
        var pending = await PendingCountAsync(id);
        if (pending == 0) return (new ApiError("nobody", "אין נמענים שעוד לא קיבלו את הדיוור."), 409);
        if (req.Confirm != pending) return (new ApiError("confirm", $"לאישור השליחה יש להקליד את מספר הנמענים: {pending}."), 409);
        i.Status = "sending";
        i.StatusNote = null;
        i.SendStartedAt ??= DateTime.UtcNow;
        await db.SaveChangesAsync();
        runner.Start(id, siteUrl);
        return (new { ok = true, pending }, 200);
    }

    public async Task<bool> StopAsync(Guid id)
    {
        var stopped = runner.Stop(id);
        var i = await db.NewsletterIssues.FirstOrDefaultAsync(x => x.Id == id);
        if (i is { Status: "sending" } && !runner.IsRunning(id))
        {
            i.Status = "paused";
            i.StatusNote = "השליחה הופסקה ידנית. אפשר להמשיך מאותה נקודה.";
            await db.SaveChangesAsync();
        }
        return stopped;
    }

    /// <summary>The send itself (run by <see cref="NewsletterRunner"/>): one personal email at a time, never twice to an address.</summary>
    public async Task RunAsync(Guid id, string siteUrl, CancellationToken stop)
    {
        var issue = await db.NewsletterIssues.FirstAsync(x => x.Id == id);
        var c = NewsletterContent.FromJson(issue.ContentJson);
        var emails = await Pending(id).OrderBy(x => x.ConsentedAt).Select(x => x.Email).ToListAsync(stop);
        var trackedLinks = await tracking.EnsureLinksAsync(issue, c);
        string? note = null;
        foreach (var email in emails)
        {
            if (stop.IsCancellationRequested) { note = "השליחה הופסקה. אפשר להמשיך מאותה נקודה."; break; }
            if (await SentLast24hAsync() >= options.DailyLimit)
            {
                note = $"הגענו למכסה היומית ({options.DailyLimit} מיילים ב־24 שעות). אפשר להמשיך מחר מאותה נקודה.";
                break;
            }
            // the consent is read again right now: an address that unsubscribed a moment ago is skipped
            var consent = await db.MarketingConsents.AsNoTracking().FirstOrDefaultAsync(x => x.Email == email && x.Status == ConsentStatus.Active, stop);
            if (consent == null) continue;
            var row = await db.NewsletterDeliveries.FirstOrDefaultAsync(d => d.IssueId == id && d.Email == email, stop);
            if (row != null && row.Status != "failed") continue;
            if (row == null) { row = new NewsletterDelivery { IssueId = id, Email = email }; db.NewsletterDeliveries.Add(row); }
            row.Status = "sending";
            row.Error = null;
            row.At = DateTime.UtcNow;
            try { await db.SaveChangesAsync(stop); }
            catch (DbUpdateException) { db.ChangeTracker.Clear(); continue; } // another run claimed it

            var r = await RecipientAsync(email, c, siteUrl, consent);
            r = r with { Tracked = await tracking.NewTrackerAsync(id, row.Id, null, trackedLinks, siteUrl) };
            try
            {
                row.ProviderMessageId = await sender.SendAsync(new EmailMessage(email, NewsletterTemplate.Subject(c),
                    NewsletterTemplate.Html(c, r, Site(siteUrl)), NewsletterTemplate.Text(c, r, Site(siteUrl)), r.UnsubscribeUrl), CancellationToken.None);
                row.Status = "sent";
            }
            catch (EmailSendException ex)
            {
                row.Status = ex.Uncertain ? "uncertain" : "failed";
                row.Error = ex.Code;
                if (ex.Code == "not-configured") { await db.SaveChangesAsync(CancellationToken.None); note = "שליחת המיילים התנתקה. יש לחבר מחדש ולהמשיך."; break; }
            }
            row.At = DateTime.UtcNow;
            await db.SaveChangesAsync(CancellationToken.None);
            if (options.Pause > TimeSpan.Zero) await Task.Delay(options.Pause, stop).ContinueWith(_ => { });
        }

        db.ChangeTracker.Clear();
        issue = await db.NewsletterIssues.FirstAsync(x => x.Id == id);
        var failed = await db.NewsletterDeliveries.CountAsync(d => d.IssueId == id && d.Status == "failed");
        var left = await PendingCountAsync(id);
        if (note == null && left == 0)
        {
            issue.Status = "sent";
            issue.SendFinishedAt = DateTime.UtcNow;
        }
        else
        {
            issue.Status = "paused";
            issue.StatusNote = note ?? $"{failed} מיילים נכשלו. אפשר לנסות לשלוח להם שוב.";
        }
        await db.SaveChangesAsync(CancellationToken.None);
    }

    public async Task<object> DeliveriesAsync(Guid id) =>
        await db.NewsletterDeliveries.AsNoTracking().Where(d => d.IssueId == id).OrderByDescending(d => d.At).Take(2000)
            .Select(d => new { d.Email, d.Status, d.Error, d.At }).ToListAsync();
}

/// <summary>Runs each send in the background, one at a time per mailing, and stops with the server.</summary>
public sealed class NewsletterRunner(IServiceScopeFactory scopes, IHostApplicationLifetime life, ILogger<NewsletterRunner> logger)
{
    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _running = new();

    public bool IsRunning(Guid id) => _running.ContainsKey(id);

    /// <summary>The task of the last start (tests wait on it).</summary>
    public Task? Last { get; private set; }

    public void Start(Guid id, string siteUrl)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(life.ApplicationStopping);
        if (!_running.TryAdd(id, cts)) { cts.Dispose(); return; }
        Last = Task.Run(async () =>
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<NewsletterService>().RunAsync(id, siteUrl, cts.Token);
            }
            catch (Exception ex)
            {
                logger.LogWarning("Newsletter send stopped ({Type})", ex.GetType().Name);
                try
                {
                    using var scope = scopes.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
                    var i = await db.NewsletterIssues.FirstOrDefaultAsync(x => x.Id == id);
                    if (i is { Status: "sending" }) { i.Status = "paused"; i.StatusNote = "השליחה נעצרה בגלל תקלה. אפשר להמשיך מאותה נקודה."; await db.SaveChangesAsync(); }
                }
                catch { /* the admin still sees "sending" without a running send and can resume */ }
            }
            finally
            {
                _running.TryRemove(id, out _);
                cts.Dispose();
            }
        });
    }

    public bool Stop(Guid id)
    {
        if (!_running.TryGetValue(id, out var cts)) return false;
        try { cts.Cancel(); } catch (ObjectDisposedException) { }
        return true;
    }
}
