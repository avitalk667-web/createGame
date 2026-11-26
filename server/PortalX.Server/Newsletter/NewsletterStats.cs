using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Newsletter;

/// <summary>
/// The numbers of each "סודות הפורטל" mailing, for the admin only.
///
/// A "clicker" is a recipient of a real email (not a test) with at least one click that does not look automatic; they
/// count once however many times they clicked. "Clicks" counts every such click. CTR = clickers ÷ emails sent
/// successfully × 100. An "opener" (an estimate) is an email whose invisible picture loaded or that was clicked. Suspected scanner clicks are counted apart and never as people. A purchase counts for a mailing
/// only through the key its click placed in the browser (<see cref="NewsletterTracking.AttributeAsync"/>), when the
/// order was paid (not a test payment, not refunded).
/// </summary>
public sealed class NewsletterStats(PortalDbContext db)
{
    public static readonly string[] Filters = ["all", "opened", "not-opened", "clicked", "not-clicked", "game", "catalog", "share", "purchased"];

    private sealed record Click(long Id, long? DeliveryId, Guid LinkId, DateTime ClickedAt, bool IsAutomated, string? AutomatedReason);

    private sealed record Bought(Guid OrderId, long? DeliveryId, long Number, decimal Amount, string Currency, DateTime ClickedAt, DateTime? PaidAt);

    public static double? Ctr(int clickers, int sent) => sent <= 0 ? null : Math.Round(clickers * 100.0 / sent, 1);

    /// <summary>
    /// The first moment each email of the mailing was seen opened: its picture loaded (not automatically), or else its
    /// first real click — a click means the email was open even when its pictures were not shown. An estimate.
    /// </summary>
    private async Task<Dictionary<long, DateTime>> OpenedAsync(Guid id, IEnumerable<Click> clicks)
    {
        var opened = (await db.NewsletterOpenEvents.AsNoTracking()
                .Where(o => o.IssueId == id && !o.IsTest && !o.IsAutomated && o.DeliveryId != null)
                .GroupBy(o => o.DeliveryId!.Value).Select(g => new { g.Key, At = g.Min(o => o.OpenedAt) }).ToListAsync())
            .ToDictionary(x => x.Key, x => x.At);
        foreach (var c in clicks.Where(c => !c.IsAutomated && c.DeliveryId != null))
            if (!opened.TryGetValue(c.DeliveryId!.Value, out var at) || c.ClickedAt < at) opened[c.DeliveryId!.Value] = c.ClickedAt;
        return opened;
    }

    private Task<List<Click>> ClicksAsync(Guid id) =>
        db.NewsletterClickEvents.AsNoTracking().Where(c => c.IssueId == id && !c.IsTest)
            .Select(c => new Click(c.Id, c.DeliveryId, c.LinkId, c.ClickedAt, c.IsAutomated, c.AutomatedReason)).ToListAsync();

    /// <summary>Paid, real orders tied to this mailing through a click.</summary>
    private Task<List<Bought>> PurchasesAsync(Guid id) =>
        (from a in db.NewsletterOrderAttributions.AsNoTracking()
         join o in db.Orders.AsNoTracking() on a.OrderId equals o.Id
         where a.IssueId == id && o.Status == OrderStatus.Paid && !o.IsTest
         select new Bought(o.Id, a.DeliveryId, o.Number, o.PriceSnapshot, o.Currency, a.ClickedAt, o.PaidAt)).ToListAsync();

    // ---------------------------------------------------------------- one mailing

    public async Task<object?> IssueAsync(Guid id)
    {
        var issue = await db.NewsletterIssues.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id);
        if (issue == null) return null;
        var counts = await db.NewsletterDeliveries.AsNoTracking().Where(d => d.IssueId == id).GroupBy(d => d.Status)
            .Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N);
        var sent = counts.GetValueOrDefault("sent");
        var links = await db.NewsletterLinks.AsNoTracking().Where(l => l.IssueId == id).OrderBy(l => l.Slot).ToListAsync();
        var clicks = await ClicksAsync(id);
        var human = clicks.Where(c => !c.IsAutomated && c.DeliveryId != null).ToList();
        var clickers = human.Select(c => c.DeliveryId).Distinct().Count();
        var bought = await PurchasesAsync(id);
        var testClicks = await db.NewsletterClickEvents.CountAsync(c => c.IssueId == id && c.IsTest);
        var opened = await OpenedAsync(id, clicks);
        var byPicture = await db.NewsletterOpenEvents.AsNoTracking().Where(o => o.IssueId == id && !o.IsTest && !o.IsAutomated && o.DeliveryId != null)
            .Select(o => o.DeliveryId).Distinct().CountAsync();
        var automatedOpens = await db.NewsletterOpenEvents.CountAsync(o => o.IssueId == id && !o.IsTest && o.IsAutomated);
        var testOpens = await db.NewsletterOpenEvents.CountAsync(o => o.IssueId == id && o.IsTest);

        return new
        {
            issue = new { issue.Id, issue.Name, issue.Status, issue.SendStartedAt, issue.SendFinishedAt },
            cards = new
            {
                sent,
                failed = counts.GetValueOrDefault("failed"),
                uncertain = counts.GetValueOrDefault("uncertain") + counts.GetValueOrDefault("sending"),
                openers = opened.Count,
                openRate = Ctr(opened.Count, sent),
                openedByPicture = byPicture,
                automatedOpens,
                testOpens,
                clickers,
                ctr = Ctr(clickers, sent),
                // of those who opened, how many clicked
                clickToOpen = Ctr(clickers, opened.Count),
                clicks = human.Count,
                automated = clicks.Count(c => c.IsAutomated),
                testClicks,
                purchases = bought.Count,
                revenue = bought.Sum(b => b.Amount),
                currency = bought.FirstOrDefault()?.Currency ?? "ILS",
                lastClickAt = human.Count == 0 ? (DateTime?)null : human.Max(c => c.ClickedAt),
            },
            links = links.Select(l =>
            {
                var mine = human.Where(c => c.LinkId == l.Id).ToList();
                var unique = mine.Select(c => c.DeliveryId).Distinct().Count();
                return new
                {
                    l.Slot, l.Kind, l.Category, l.Label, unique, clicks = mine.Count, ctr = Ctr(unique, sent),
                    automated = clicks.Count(c => c.LinkId == l.Id && c.IsAutomated),
                };
            }).ToList(),
            automatedReasons = clicks.Where(c => c.IsAutomated).GroupBy(c => c.AutomatedReason ?? "agent")
                .Select(g => new { reason = g.Key, count = g.Count() }).OrderByDescending(x => x.count).ToList(),
            // clicks by day (Israel time) for the small chart
            days = human.GroupBy(c => IsraelDate(c.ClickedAt)).OrderBy(g => g.Key)
                .Select(g => new { day = g.Key, clicks = g.Count(), clickers = g.Select(c => c.DeliveryId).Distinct().Count() }).ToList(),
            // first openings by day (Israel time)
            openDays = opened.Values.GroupBy(IsraelDate).OrderBy(g => g.Key).Select(g => new { day = g.Key, openers = g.Count() }).ToList(),
            attributionDays = (int)NewsletterTracking.AttributionWindow.TotalDays,
        };
    }

    private static readonly TimeZoneInfo Israel = FindIsrael();
    private static TimeZoneInfo FindIsrael()
    {
        foreach (var name in new[] { "Asia/Jerusalem", "Israel Standard Time" })
            try { return TimeZoneInfo.FindSystemTimeZoneById(name); } catch { }
        return TimeZoneInfo.Utc;
    }
    private static string IsraelDate(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Israel).ToString("yyyy-MM-dd");

    // ---------------------------------------------------------------- who clicked

    /// <summary>
    /// Every recipient of the mailing with their clicks and purchases. "unknown" purchase = the same address paid for an
    /// order within the window after clicking, but nothing ties that order to the email (another device, a cleared
    /// browser): shown as "לא ניתן לשייך", never counted.
    /// </summary>
    public async Task<object?> RecipientsAsync(Guid id, string? filter)
    {
        var issue = await db.NewsletterIssues.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id);
        if (issue == null) return null;
        filter = Filters.Contains(filter) ? filter : "all";
        var deliveries = await db.NewsletterDeliveries.AsNoTracking().Where(d => d.IssueId == id)
            .Select(d => new { d.Id, d.Email, d.Status, d.At }).ToListAsync();
        var emails = deliveries.Select(d => d.Email).ToList();
        var names = (await db.ReferralLinks.AsNoTracking().Where(l => emails.Contains(l.Email))
                .OrderBy(l => l.CreatedAt).Select(l => new { l.Email, l.FirstName }).ToListAsync())
            .GroupBy(l => l.Email).ToDictionary(g => g.Key, g => g.Last().FirstName);
        var links = await db.NewsletterLinks.AsNoTracking().Where(l => l.IssueId == id).ToDictionaryAsync(l => l.Id);
        var all = await ClicksAsync(id);
        var opened = await OpenedAsync(id, all);
        var human = all.Where(c => !c.IsAutomated && c.DeliveryId != null).GroupBy(c => c.DeliveryId!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());
        var bought = (await PurchasesAsync(id)).Where(b => b.DeliveryId != null).GroupBy(b => b.DeliveryId!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());

        // paid orders of the same addresses that nothing ties to this mailing
        var since = issue.SendStartedAt ?? issue.CreatedAt;
        var lowered = emails.Select(e => e.ToLowerInvariant()).ToList();
        var others = await db.Orders.AsNoTracking()
            .Where(o => o.Email != null && o.Status == OrderStatus.Paid && !o.IsTest && o.CreatedAt >= since && lowered.Contains(o.Email.ToLower())
                && !db.NewsletterOrderAttributions.Any(a => a.OrderId == o.Id))
            .Select(o => new { o.Id, Email = o.Email!.ToLower(), o.CreatedAt }).ToListAsync();

        var rows = deliveries.Select(d =>
        {
            var mine = human.GetValueOrDefault(d.Id) ?? [];
            var first = mine.Count == 0 ? (DateTime?)null : mine.Min(c => c.ClickedAt);
            var clickedLinks = mine.Select(c => links.GetValueOrDefault(c.LinkId)).Where(l => l != null).DistinctBy(l => l!.Id).OrderBy(l => l!.Slot).ToList();
            var orders = bought.GetValueOrDefault(d.Id) ?? [];
            var unknown = orders.Count == 0 && first != null && others.Any(o => o.Email == d.Email.ToLowerInvariant()
                && o.CreatedAt >= first && o.CreatedAt <= first.Value + NewsletterTracking.AttributionWindow);
            return new
            {
                d.Email, name = names.GetValueOrDefault(d.Email), d.Status, sentAt = d.At,
                openedAt = opened.TryGetValue(d.Id, out var seen) ? seen : (DateTime?)null,
                firstClickAt = first, clicks = mine.Count,
                links = clickedLinks.Select(l => l!.Label).ToList(),
                categories = clickedLinks.Select(l => l!.Category).Distinct().ToList(),
                purchase = orders.Count > 0 ? "yes" : unknown ? "unknown" : null,
                orders = orders.Select(o => new { o.Number, o.Amount, o.PaidAt }).ToList(),
            };
        }).ToList();

        var counts = new Dictionary<string, int>
        {
            ["all"] = rows.Count,
            ["opened"] = rows.Count(r => r.openedAt != null),
            ["not-opened"] = rows.Count(r => r.openedAt == null && r.Status == "sent"),
            ["clicked"] = rows.Count(r => r.clicks > 0),
            ["not-clicked"] = rows.Count(r => r.clicks == 0),
            ["game"] = rows.Count(r => r.categories.Contains("game")),
            ["catalog"] = rows.Count(r => r.categories.Contains("catalog")),
            ["share"] = rows.Count(r => r.categories.Contains("share")),
            ["purchased"] = rows.Count(r => r.purchase == "yes"),
        };
        var shown = rows.Where(r => filter switch
        {
            "opened" => r.openedAt != null,
            "not-opened" => r.openedAt == null && r.Status == "sent",
            "clicked" => r.clicks > 0,
            "not-clicked" => r.clicks == 0,
            "game" => r.categories.Contains("game"),
            "catalog" => r.categories.Contains("catalog"),
            "share" => r.categories.Contains("share"),
            "purchased" => r.purchase == "yes",
            _ => true,
        }).OrderByDescending(r => r.firstClickAt ?? DateTime.MinValue).ThenByDescending(r => r.openedAt ?? DateTime.MinValue).ThenBy(r => r.Email).Take(2000).ToList();
        return new { filter, counts, rows = shown };
    }

    // ---------------------------------------------------------------- all mailings side by side

    public async Task<object> CompareAsync()
    {
        var issues = await db.NewsletterIssues.AsNoTracking()
            .Where(i => i.Status != "draft" || db.NewsletterDeliveries.Any(d => d.IssueId == i.Id))
            .OrderByDescending(i => i.SendStartedAt ?? i.CreatedAt).Take(200)
            .Select(i => new { i.Id, i.Name, i.Status, i.SendStartedAt, i.CreatedAt }).ToListAsync();
        var ids = issues.Select(i => i.Id).ToList();
        var sent = await db.NewsletterDeliveries.AsNoTracking().Where(d => ids.Contains(d.IssueId) && d.Status == "sent")
            .GroupBy(d => d.IssueId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N);
        var clicks = await db.NewsletterClickEvents.AsNoTracking()
            .Where(c => ids.Contains(c.IssueId) && !c.IsTest && !c.IsAutomated && c.DeliveryId != null)
            .Select(c => new { c.IssueId, c.DeliveryId }).ToListAsync();
        var opens = await db.NewsletterOpenEvents.AsNoTracking()
            .Where(o => ids.Contains(o.IssueId) && !o.IsTest && !o.IsAutomated && o.DeliveryId != null)
            .Select(o => new { o.IssueId, o.DeliveryId }).Distinct().ToListAsync();
        var bought = await (from a in db.NewsletterOrderAttributions.AsNoTracking()
                            join o in db.Orders.AsNoTracking() on a.OrderId equals o.Id
                            where ids.Contains(a.IssueId) && o.Status == OrderStatus.Paid && !o.IsTest
                            select new { a.IssueId, o.PriceSnapshot }).ToListAsync();
        return new
        {
            issues = issues.Select(i =>
            {
                var s = sent.GetValueOrDefault(i.Id);
                var mine = clicks.Where(c => c.IssueId == i.Id).ToList();
                var clickers = mine.Select(c => c.DeliveryId).Distinct().Count();
                var openers = opens.Where(o => o.IssueId == i.Id).Select(o => o.DeliveryId).Union(mine.Select(c => c.DeliveryId)).Distinct().Count();
                var b = bought.Where(x => x.IssueId == i.Id).ToList();
                return new
                {
                    i.Id, i.Name, i.Status, sentAt = i.SendStartedAt, sent = s, openers, openRate = Ctr(openers, s), clickers, clicks = mine.Count, ctr = Ctr(clickers, s),
                    purchases = b.Count, revenue = b.Sum(x => x.PriceSnapshot),
                };
            }).ToList(),
            attributionDays = (int)NewsletterTracking.AttributionWindow.TotalDays,
        };
    }
}
