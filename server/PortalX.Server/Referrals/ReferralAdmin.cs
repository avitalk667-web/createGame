using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Mail;

namespace PortalX.Server.Referrals;

/// <summary>
/// Filters of the "personal links" admin tab. Two separate date ranges: when the link was created, and when its purchases
/// were paid (the purchase range limits which purchases are counted in the numbers).
/// </summary>
public sealed record ReferralFilter(string? Search, DateTime? CreatedFrom, DateTime? CreatedTo, DateTime? PaidFrom, DateTime? PaidTo,
    string? Game, int? MinPurchases, decimal? MinNet, string? Status)
{
    public static ReferralFilter Parse(HttpRequest r)
    {
        string? S(string k) => string.IsNullOrWhiteSpace(r.Query[k]) ? null : r.Query[k].ToString().Trim();
        static DateTime? D(string? s, bool end) => DateTime.TryParse(s, CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var d) ? (end && d.TimeOfDay == TimeSpan.Zero ? d.AddDays(1) : d) : null;
        return new ReferralFilter(S("search")?.ToLowerInvariant(), D(S("createdFrom"), false), D(S("createdTo"), true),
            D(S("paidFrom"), false), D(S("paidTo"), true), S("game"),
            int.TryParse(S("minPurchases"), out var n) ? n : null,
            decimal.TryParse(S("minNet"), NumberStyles.Number, CultureInfo.InvariantCulture, out var m) ? m : null, S("status"));
    }
}

/// <summary>Money of one currency: never added across currencies.</summary>
public sealed record MoneyTotals(string Currency, decimal Gross, decimal Refunds, decimal Net);

public sealed record GameCount(string ProductId, string Name, int Purchases);

public sealed record ReferralRow(
    Guid Id, string FirstName, string LastName, string Email, string Url, DateTime CreatedAt, string Status,
    int Purchases, int Refunded, IReadOnlyList<MoneyTotals> Money, IReadOnlyList<GameCount> Games,
    string? LastEmailStatus, DateTime? LastEmailAt, string Consent, int DrawBuyers = 0, bool DrawEligible = false);

/// <summary>
/// The admin's view of personal links. A purchase counts for a link only when: it came through the link (set at checkout),
/// it was really paid (a verified payment notification), it is not a test payment and not the owner's own purchase.
/// Gross = what was charged; refunds = what was really refunded; net = gross − refunds. Pending, failed and cancelled
/// orders are never revenue.
/// </summary>
public sealed class ReferralAdmin(PortalDbContext db, CampaignContent campaign)
{
    /// <summary>Whether an attributed order counts in the link's numbers.</summary>
    public static bool Counts(Order o) =>
        o.ReferralLinkId != null && o.PaidAt != null && o.Status is OrderStatus.Paid or OrderStatus.Refunded && !o.IsTest && o.ReferralExclusion == null;

    public static decimal RefundOf(Order o) => o.Status == OrderStatus.Refunded ? Math.Min(o.RefundedAmount ?? o.PriceSnapshot, o.PriceSnapshot) : 0;

    private static List<MoneyTotals> Money(IEnumerable<Order> orders) => orders.GroupBy(o => o.Currency).OrderBy(g => g.Key)
        .Select(g => new MoneyTotals(g.Key, g.Sum(o => o.PriceSnapshot), g.Sum(RefundOf), g.Sum(o => o.PriceSnapshot) - g.Sum(RefundOf))).ToList();

    public async Task<(List<ReferralRow> Rows, object Summary)> ListAsync(ReferralFilter f, string siteUrl)
    {
        var q = db.ReferralLinks.AsNoTracking().AsQueryable();
        if (f.CreatedFrom is { } cf) q = q.Where(l => l.CreatedAt >= cf);
        if (f.CreatedTo is { } ct) q = q.Where(l => l.CreatedAt < ct);
        if (f.Status == "active") q = q.Where(l => l.Status == ReferralLinkStatus.Active);
        if (f.Status == "disabled") q = q.Where(l => l.Status == ReferralLinkStatus.Disabled);
        var links = await q.OrderByDescending(l => l.CreatedAt).ToListAsync();
        if (f.Search != null)
            links = links.Where(l => l.Email.Contains(f.Search) || l.FirstName.ToLowerInvariant().Contains(f.Search) || l.LastName.ToLowerInvariant().Contains(f.Search)
                || (l.FirstName + " " + l.LastName).ToLowerInvariant().Contains(f.Search)).ToList();

        var ids = links.Select(l => l.Id).ToList();
        var orders = await db.Orders.AsNoTracking().Where(o => o.ReferralLinkId != null && ids.Contains(o.ReferralLinkId.Value)).ToListAsync();
        var counted = orders.Where(Counts)
            .Where(o => (f.PaidFrom == null || o.PaidAt >= f.PaidFrom) && (f.PaidTo == null || o.PaidAt < f.PaidTo)).ToList();
        var byLink = counted.GroupBy(o => o.ReferralLinkId!.Value).ToDictionary(g => g.Key, g => g.ToList());
        // the campaign counts every qualifying purchase of the link, whatever the purchase dates filtered above
        var drawBuyers = orders.GroupBy(o => o.ReferralLinkId!.Value).ToDictionary(g => g.Key, g => CampaignContent.QualifyingBuyers(g));
        var consents = await db.MarketingConsents.AsNoTracking().Where(c => links.Select(l => l.Email).Contains(c.Email))
            .ToDictionaryAsync(c => c.Email, c => c.Status == ConsentStatus.Active ? "active" : c.Status == ConsentStatus.Revoked ? "revoked" : "pending");

        var rows = links.Select(l =>
        {
            var mine = byLink.GetValueOrDefault(l.Id) ?? [];
            var games = mine.GroupBy(o => o.ProductId).Select(g => new GameCount(g.Key, g.First().ProductName, g.Count())).OrderByDescending(g => g.Purchases).ToList();
            return new ReferralRow(l.Id, l.FirstName, l.LastName, l.Email, ReferralService.LinkUrl(l, siteUrl), l.CreatedAt,
                l.Status == ReferralLinkStatus.Active ? "active" : "disabled", mine.Count, mine.Count(o => o.Status == OrderStatus.Refunded),
                Money(mine), games, l.LastEmailStatus, l.LastEmailAt, consents.GetValueOrDefault(l.Email, "none"),
                drawBuyers.GetValueOrDefault(l.Id), drawBuyers.GetValueOrDefault(l.Id) >= campaign.MinBuyers);
        });
        if (f.Game != null) rows = rows.Where(r => r.Games.Any(g => g.ProductId == f.Game));
        if (f.MinPurchases is { } minP) rows = rows.Where(r => r.Purchases >= minP);
        if (f.MinNet is { } minN) rows = rows.Where(r => r.Money.Sum(m => m.Net) >= minN);
        var list = rows.ToList();

        var shownIds = list.Select(r => r.Id).ToHashSet();
        var shownOrders = counted.Where(o => shownIds.Contains(o.ReferralLinkId!.Value)).ToList();
        var summary = new
        {
            links = list.Count,
            activeLinks = list.Count(r => r.Status == "active"),
            drawEligible = list.Count(r => r.DrawEligible),
            drawMinBuyers = campaign.MinBuyers,
            purchases = shownOrders.Count,
            refunded = shownOrders.Count(o => o.Status == OrderStatus.Refunded),
            money = Money(shownOrders),
        };
        return (list, summary);
    }

    public async Task<object?> DetailsAsync(Guid id, string siteUrl)
    {
        var l = await db.ReferralLinks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (l == null) return null;
        var orders = await db.Orders.AsNoTracking().Where(o => o.ReferralLinkId == id).OrderByDescending(o => o.CreatedAt).ToListAsync();
        var counted = orders.Where(Counts).ToList();
        var consent = await db.MarketingConsents.AsNoTracking().FirstOrDefaultAsync(c => c.Email == l.Email);
        return new
        {
            l.Id, l.FirstName, l.LastName, l.Email, url = ReferralService.LinkUrl(l, siteUrl), l.CreatedAt,
            status = l.Status == ReferralLinkStatus.Active ? "active" : "disabled", l.DisabledAt,
            l.LastEmailStatus, l.LastEmailAt, l.EmailsSent,
            consent = consent == null ? "none" : consent.Status == ConsentStatus.Active ? "active" : consent.Status == ConsentStatus.Revoked ? "revoked" : "pending",
            consentAt = l.ConsentAt, consentRevokedAt = consent?.RevokedAt,
            purchases = counted.Count, money = Money(counted),
            drawBuyers = CampaignContent.QualifyingBuyers(orders), drawMinBuyers = campaign.MinBuyers,
            // a commission plan is prepared but off: nothing is calculated or paid
            commission = new { mode = l.CommissionMode.ToString().ToLowerInvariant(), enabled = l.CommissionEnabled },
            // only what managing the links needs: no buyer details, no payment details
            orders = orders.Select(o => new
            {
                o.Id, o.Number, o.CreatedAt, o.PaidAt, o.ProductId, o.ProductName, amount = o.PriceSnapshot, o.Currency,
                status = o.Status.ToString().ToLowerInvariant(), o.IsTest, o.RefundedAt, refunded = RefundOf(o), o.ReferralAttributedAt,
                counted = Counts(o),
                excluded = o.IsTest ? "test" : o.ReferralExclusion ?? (o.PaidAt == null ? "not-paid" : null),
            }),
        };
    }

    public async Task<byte[]> CsvAsync(ReferralFilter f, string siteUrl)
    {
        static string Money(IReadOnlyList<MoneyTotals> m, Func<MoneyTotals, decimal> pick) => m.Count == 0 ? "0"
            : string.Join(" · ", m.Select(x => $"{pick(x).ToString("0.##", CultureInfo.InvariantCulture)} {x.Currency}"));
        var (rows, _) = await ListAsync(f, siteUrl);
        var sb = new StringBuilder("﻿");
        sb.AppendLine(string.Join(",", new[]
        {
            "שם פרטי", "שם משפחה", "מייל", "קישור אישי", "תאריך יצירה", "מספר רכישות", "מכירות ברוטו", "החזרים", "הכנסה נטו",
            "משחקים שנרכשו", "סטטוס", "הסכמה שיווקית", "מייל קישור אחרון", "רוכשים שונים (מבצע)", "זכאות להגרלה",
        }.Select(CsvText.Cell)));
        foreach (var r in rows)
            sb.AppendLine(string.Join(",", new object?[]
            {
                r.FirstName, r.LastName, r.Email, r.Url, r.CreatedAt, r.Purchases, Money(r.Money, x => x.Gross), Money(r.Money, x => x.Refunds), Money(r.Money, x => x.Net),
                string.Join(" · ", r.Games.Select(g => $"{g.Name} ({g.Purchases})")), r.Status == "active" ? "פעיל" : "מושבת",
                r.Consent switch { "active" => "פעילה", "revoked" => "בוטלה", _ => "אין" }, r.LastEmailAt, r.DrawBuyers, r.DrawEligible ? "כן" : "לא",
            }.Select(CsvText.Cell)));
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    public async Task<bool> SetStatusAsync(Guid id, bool active)
    {
        var now = DateTime.UtcNow;
        return await db.ReferralLinks.Where(l => l.Id == id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.Status, active ? ReferralLinkStatus.Active : ReferralLinkStatus.Disabled)
            .SetProperty(l => l.DisabledAt, active ? null : now)
            .SetProperty(l => l.UpdatedAt, now)) > 0;
    }
}
