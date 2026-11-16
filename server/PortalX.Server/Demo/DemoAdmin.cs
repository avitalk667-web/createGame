using Microsoft.EntityFrameworkCore;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Demo;

/// <summary>
/// The admin's "טעימה מהפורטל" tab: the funnel of the free taste in a range of Israel days, read from the real tables.
/// Sessions are counted by the day they started (a cohort), so every rate compares the same people; the home page's
/// impressions and clicks are events counted on their own day. A purchase counts only when the provider confirmed the
/// payment (the order's paid transition) and never when it was a test payment; test purchases are shown apart.
/// Nothing personal is read or returned: no tokens, no e-mail addresses.
/// </summary>
public sealed class DemoAdmin(PortalDbContext db)
{
    /// <summary>The steps of the room, in order, for "where players stop" (the session's last event).</summary>
    private static readonly string[] Steps =
    [
        "demo_started", "demo_item_inspected", "demo_hint_requested", "demo_code_attempt", "demo_completed",
        "demo_offer_viewed", "demo_product_clicked", "demo_checkout_started", "demo_purchase_completed",
    ];

    private static double Rate(int part, int whole) => whole == 0 ? 0 : Math.Round(100.0 * part / whole, 1);

    public async Task<object> GetAsync(StatisticsFilter f)
    {
        var from = StatisticsService.StartUtc(f.From);
        var to = StatisticsService.StartUtc(f.To.AddDays(1));

        var sessions = await db.DemoSessions.AsNoTracking().Where(s => s.CreatedAt >= from && s.CreatedAt < to).ToListAsync();
        var homeEvents = await db.DemoEvents.AsNoTracking()
            .Where(e => (e.Type == "demo_impression" || e.Type == "demo_click") && e.At >= from && e.At < to)
            .Select(e => new { e.Type, e.At }).ToListAsync();
        var abandonedIds = (await db.DemoEvents.AsNoTracking()
            .Where(e => e.Type == "demo_abandoned" && e.At >= from && e.At < to && e.SessionId != null)
            .Select(e => e.SessionId!.Value).ToListAsync()).ToHashSet();

        // the orders of these sessions: the purchase is real only for a paid (or later refunded) order that is not a test
        var ids = sessions.Select(s => s.Id).ToList();
        var orders = await db.Orders.AsNoTracking().Where(o => o.DemoSessionId != null && ids.Contains(o.DemoSessionId.Value))
            .Select(o => new { o.Id, SessionId = o.DemoSessionId!.Value, o.ProductId, o.ProductName, o.Status, o.IsTest, o.PriceSnapshot, o.RefundedAmount, o.PaidAt })
            .ToListAsync();
        var paidOrders = orders.Where(o => o.PaidAt != null && o.Status is OrderStatus.Paid or OrderStatus.Refunded).ToList();
        var realPaid = paidOrders.Where(o => !o.IsTest).ToList();
        var buyers = realPaid.Select(o => o.SessionId).ToHashSet();
        decimal revenue = realPaid.Sum(o => o.PriceSnapshot - (o.Status == OrderStatus.Refunded ? Math.Min(o.RefundedAmount ?? o.PriceSnapshot, o.PriceSnapshot) : 0));

        int impressions = homeEvents.Count(e => e.Type == "demo_impression"), clicks = homeEvents.Count(e => e.Type == "demo_click");
        var started = sessions.Count;
        var completed = sessions.Where(s => s.CompletedAt != null).ToList();
        int offer = sessions.Count(s => s.OfferViewedAt != null), product = sessions.Count(s => s.ProductClickedAt != null);
        int checkout = sessions.Count(s => s.CheckoutStartedAt != null), purchased = buyers.Count;
        var seconds = completed.Select(s => (s.CompletedAt!.Value - s.CreatedAt).TotalSeconds).OrderBy(x => x).ToList();
        var notDone = sessions.Where(s => s.CompletedAt == null).ToList();

        // the referral links of these sessions, by name only
        var linkIds = sessions.Where(s => s.ReferralLinkId != null).Select(s => s.ReferralLinkId!.Value).Distinct().ToList();
        var linkNames = await db.ReferralLinks.AsNoTracking().Where(l => linkIds.Contains(l.Id))
            .Select(l => new { l.Id, Name = (l.FirstName + " " + l.LastName).Trim() }).ToDictionaryAsync(l => l.Id, l => l.Name);

        object Group(IEnumerable<DemoSession> list, string key) => new
        {
            key,
            started = list.Count(),
            completed = list.Count(s => s.CompletedAt != null),
            productClicked = list.Count(s => s.ProductClickedAt != null),
            purchased = list.Count(s => buyers.Contains(s.Id)),
        };

        var series = StatisticsService.Buckets(f).Select(b =>
        {
            bool At(DateTime? t) => t is { } v && v >= from && v < to && StatisticsService.BucketOf(v, f.Bucket) == b;
            return new
            {
                start = b.ToString("yyyy-MM-dd"),
                impressions = homeEvents.Count(e => e.Type == "demo_impression" && At(e.At)),
                started = sessions.Count(s => At(s.CreatedAt)),
                completed = completed.Count(s => At(s.CreatedAt)),
                purchased = sessions.Count(s => buyers.Contains(s.Id) && At(s.CreatedAt)),
            };
        }).ToList();

        var paidBySession = realPaid.GroupBy(o => o.SessionId).ToDictionary(g => g.Key, g => g.First());
        var testBySession = paidOrders.Where(o => o.IsTest).GroupBy(o => o.SessionId).ToDictionary(g => g.Key, g => g.First());

        return new
        {
            range = new { from = f.From.ToString("yyyy-MM-dd"), to = f.To.ToString("yyyy-MM-dd"), bucket = f.Bucket },
            funnel = new
            {
                impressions, clicks, started, completed = completed.Count, offerViewed = offer, productClicked = product,
                checkoutStarted = checkout, purchased, testPurchases = paidOrders.Count(o => o.IsTest), revenue,
            },
            rates = new
            {
                click = Rate(clicks, impressions),
                start = Rate(started, impressions),
                completion = Rate(completed.Count, started),
                offer = Rate(offer, completed.Count),
                product = Rate(product, offer),
                checkout = Rate(checkout, product),
                purchase = Rate(purchased, checkout),
                overall = Rate(purchased, started),
                hints = Rate(sessions.Count(s => s.HintsUsed > 0), started),
                abandoned = Rate(notDone.Count, started),
            },
            time = new
            {
                averageSeconds = seconds.Count == 0 ? (int?)null : (int)Math.Round(seconds.Average()),
                medianSeconds = seconds.Count == 0 ? (int?)null : (int)Math.Round(seconds[seconds.Count / 2]),
                averageAttempts = completed.Count == 0 ? (double?)null : Math.Round(completed.Average(s => s.CodeAttempts), 1),
                averageHints = started == 0 ? (double?)null : Math.Round(sessions.Average(s => s.HintsUsed), 1),
            },
            // where the players who did not open the door stopped: their last step
            stops = Steps.Take(4).Select(step => new { step, count = notDone.Count(s => s.LastEvent == step) }).ToList(),
            leftPage = notDone.Count(s => abandonedIds.Contains(s.Id)),
            devices = sessions.GroupBy(s => s.Device).OrderByDescending(g => g.Count()).Select(g => Group(g, g.Key)).ToList(),
            variants = sessions.GroupBy(s => s.Variant).OrderBy(g => g.Key).Select(g => Group(g, g.Key)).ToList(),
            referrals = sessions.Where(s => s.ReferralLinkId != null).GroupBy(s => s.ReferralLinkId!.Value)
                .Select(g => new { name = linkNames.GetValueOrDefault(g.Key, "—"), started = g.Count(), completed = g.Count(s => s.CompletedAt != null), purchased = g.Count(s => buyers.Contains(s.Id)) })
                .OrderByDescending(x => x.purchased).ThenByDescending(x => x.started).Take(20).ToList(),
            products = realPaid.GroupBy(o => o.ProductId)
                .Select(g => new { productId = g.Key, name = g.First().ProductName, purchases = g.Count(), revenue = g.Sum(o => o.PriceSnapshot) })
                .OrderByDescending(x => x.purchases).ToList(),
            series,
            // the newest sessions of the range (anonymous: a short reference, never the token)
            sessions = sessions.OrderByDescending(s => s.CreatedAt).Take(100).Select(s => new
            {
                id = s.Id.ToString("N")[..8],
                startedAt = s.CreatedAt,
                s.Device,
                s.Variant,
                inspected = System.Numerics.BitOperations.PopCount((uint)s.InspectedMask),
                hints = s.HintsUsed,
                attempts = s.CodeAttempts,
                seconds = s.CompletedAt is { } c ? (int?)(c - s.CreatedAt).TotalSeconds : null,
                offer = s.OfferViewedAt != null,
                product = s.ProductClickedId,
                checkout = s.CheckoutStartedAt != null,
                purchase = paidBySession.TryGetValue(s.Id, out var o) ? o.ProductName : null,
                testPurchase = !paidBySession.ContainsKey(s.Id) && testBySession.ContainsKey(s.Id),
                lastEvent = s.LastEvent,
                leftPage = s.CompletedAt == null && abandonedIds.Contains(s.Id),
                referral = s.ReferralLinkId is { } l ? linkNames.GetValueOrDefault(l, "—") : null,
            }).ToList(),
        };
    }
}
