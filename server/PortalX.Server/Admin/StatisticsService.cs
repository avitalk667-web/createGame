using System.Globalization;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Referrals;

namespace PortalX.Server.Admin;

/// <summary>
/// The range of the statistics tab: Israel calendar days, both included, and how the charts group them.
/// Missing or unreadable dates mean the last 30 days.
/// </summary>
public sealed record StatisticsFilter(DateOnly From, DateOnly To, string Bucket)
{
    public static StatisticsFilter Parse(HttpRequest r, DateTime utcNow)
    {
        var today = DateOnly.FromDateTime(StatisticsService.ToIsrael(utcNow));
        static DateOnly? D(string? s) => DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
        var to = D(r.Query["to"]) ?? today;
        var from = D(r.Query["from"]) ?? to.AddDays(-29);
        if (from > to) (from, to) = (to, from);
        // a safety bound on the work of one request
        if (to.DayNumber - from.DayNumber > 3 * 366) from = to.AddDays(-3 * 366);
        var bucket = r.Query["bucket"].ToString() is "week" or "month" ? r.Query["bucket"].ToString() : "day";
        return new StatisticsFilter(from, to, bucket);
    }
}

/// <summary>
/// The admin's statistics: sales, activity, games and personal links in a date range, read from the real tables.
/// The steps of a sale are kept apart — an order, a verified payment, a game opened, a game played, a participant —
/// and only verified payments count as revenue (refunds taken off when they happen). Test payments never count.
/// </summary>
public sealed class StatisticsService(PortalDbContext db)
{
    /// <summary>Games that were never sold or played for real: the removed demo mode and games from before purchases.</summary>
    private static readonly string[] Retired = ["test-checkout", "legacy"];

    private static TimeZoneInfo Israel
    {
        get
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem"); }
            catch (Exception) { return TimeZoneInfo.CreateCustomTimeZone("IL", TimeSpan.FromHours(2), "IL", "IL"); }
        }
    }

    public static DateTime ToIsrael(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Israel);

    private static DateTime StartUtc(DateOnly day) =>
        TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(day.ToDateTime(TimeOnly.MinValue), DateTimeKind.Unspecified), Israel);

    /// <summary>The first day of the chart group a moment falls in (Israel time): its day, its week from Sunday, or its month.</summary>
    public static DateOnly BucketOf(DateTime utc, string bucket)
    {
        var d = DateOnly.FromDateTime(ToIsrael(utc));
        return bucket switch
        {
            "week" => d.AddDays(-(int)d.DayOfWeek),
            "month" => new DateOnly(d.Year, d.Month, 1),
            _ => d,
        };
    }

    private static IEnumerable<DateOnly> Buckets(StatisticsFilter f)
    {
        var first = BucketOf(StartUtc(f.From).AddHours(12), f.Bucket);
        for (var d = first; d <= f.To; d = f.Bucket switch { "week" => d.AddDays(7), "month" => d.AddMonths(1), _ => d.AddDays(1) })
            yield return d;
    }

    private static decimal RefundOf(Order o) => Math.Min(o.RefundedAmount ?? o.PriceSnapshot, o.PriceSnapshot);

    public async Task<object> GetAsync(StatisticsFilter f)
    {
        var from = StartUtc(f.From);
        var to = StartUtc(f.To.AddDays(1));
        bool In(DateTime? t) => t is { } v && v >= from && v < to;

        // ---- sales: real orders only; a payment counts when it was paid, a refund when it was refunded
        var orders = await db.Orders.AsNoTracking().Where(o => !o.IsTest
            && ((o.CreatedAt >= from && o.CreatedAt < to) || (o.PaidAt >= from && o.PaidAt < to) || (o.RefundedAt >= from && o.RefundedAt < to)))
            .ToListAsync();
        var created = orders.Where(o => In(o.CreatedAt)).ToList();
        var paid = orders.Where(o => In(o.PaidAt) && o.Status is OrderStatus.Paid or OrderStatus.Refunded).ToList();
        var refunded = orders.Where(o => In(o.RefundedAt) && o.Status == OrderStatus.Refunded).ToList();

        // ---- games: rooms opened in the range, and rooms whose players first entered the game in the range
        var rooms = await db.Rooms.AsNoTracking().Where(r => !Retired.Contains(r.AccessSource)
            && ((r.CreatedAt >= from && r.CreatedAt < to) || (r.FirstStartedAt >= from && r.FirstStartedAt < to)))
            .Select(r => new { r.Id, r.ProductId, r.AccessSource, r.CreatedAt, r.FirstStartedAt, r.ReferralLinkId, r.EntitlementId })
            .ToListAsync();
        // a room paid by a test payment is not real activity
        var testEnts = (await db.Entitlements.AsNoTracking().Where(e => e.IsTest).Select(e => e.Id).ToListAsync()).ToHashSet();
        rooms = rooms.Where(r => r.EntitlementId == null || !testEnts.Contains(r.EntitlementId.Value)).ToList();
        var opened = rooms.Where(r => In(r.CreatedAt)).ToList();
        var started = rooms.Where(r => In(r.FirstStartedAt)).ToList();

        // ---- participants: a seat taken in the range in a game that was really played (a reconnect keeps the same seat)
        var seats = await db.Players.AsNoTracking().Where(p => p.JoinedAt >= from && p.JoinedAt < to)
            .Join(db.Rooms.AsNoTracking().Where(r => !Retired.Contains(r.AccessSource) && r.FirstStartedAt != null),
                p => p.RoomId, r => r.Id, (p, r) => new { p.Id, p.JoinedAt, r.AccessSource, r.ProductId, r.EntitlementId })
            .ToListAsync();
        seats = seats.Where(s => s.EntitlementId == null || !testEnts.Contains(s.EntitlementId.Value)).ToList();

        // ---- personal links
        var links = await db.ReferralLinks.AsNoTracking().Select(l => new { l.Id, l.FirstName, l.LastName }).ToListAsync();
        var clicks = await db.ReferralClicks.AsNoTracking().Where(c => c.At >= from && c.At < to).Select(c => new { c.ReferralLinkId, c.At }).ToListAsync();
        var linkPurchases = paid.Where(ReferralAdmin.Counts).ToList();
        var linkFree = started.Where(r => r.AccessSource == "free-sample" && r.ReferralLinkId != null).ToList();

        var products = await db.Products.AsNoTracking().OrderBy(p => p.SortOrder).Select(p => new { p.Id, p.Name, p.IsFree }).ToListAsync();

        decimal gross = paid.Sum(o => o.PriceSnapshot), refunds = refunded.Sum(RefundOf);

        var series = Buckets(f).Select(b =>
        {
            bool At(DateTime? t) => t is { } v && In(v) && BucketOf(v, f.Bucket) == b;
            var g = paid.Where(o => At(o.PaidAt)).Sum(o => o.PriceSnapshot) - refunded.Where(o => At(o.RefundedAt)).Sum(RefundOf);
            return new
            {
                start = b.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                revenue = g,
                purchases = paid.Count(o => At(o.PaidAt)),
                gamesOpened = opened.Count(r => At(r.CreatedAt)),
                gamesStarted = started.Count(r => At(r.FirstStartedAt)),
                freeOpened = opened.Count(r => r.AccessSource == "free-sample" && At(r.CreatedAt)),
                freeStarted = started.Count(r => r.AccessSource == "free-sample" && At(r.FirstStartedAt)),
                participants = seats.Count(s => At(s.JoinedAt)),
                visits = clicks.Count(c => At(c.At)),
            };
        }).ToList();

        return new
        {
            range = new { from = f.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), to = f.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), bucket = f.Bucket },
            currency = "ILS",
            sales = new
            {
                ordersCreated = created.Count,
                purchases = paid.Count,
                gross, refunds, net = gross - refunds,
                refundCount = refunded.Count,
                pending = created.Count(o => o.Status == OrderStatus.Pending),
                failed = created.Count(o => o.Status == OrderStatus.Failed),
                cancelled = created.Count(o => o.Status == OrderStatus.Cancelled),
                paidGamesOpened = opened.Count(r => r.AccessSource == "purchase"),
                paidGamesStarted = started.Count(r => r.AccessSource == "purchase"),
            },
            activity = new
            {
                gamesOpened = opened.Count,
                gamesStarted = started.Count,
                participants = seats.Count,
                freeOpened = opened.Count(r => r.AccessSource == "free-sample"),
                freeStarted = started.Count(r => r.AccessSource == "free-sample"),
                freeParticipants = seats.Count(s => s.AccessSource == "free-sample"),
                adminOpened = opened.Count(r => r.AccessSource == "admin-free"),
            },
            byProduct = products.Select(p => new
            {
                productId = p.Id, name = p.Name, isFree = p.IsFree,
                purchases = paid.Count(o => o.ProductId == p.Id),
                net = paid.Where(o => o.ProductId == p.Id).Sum(o => o.PriceSnapshot) - refunded.Where(o => o.ProductId == p.Id).Sum(RefundOf),
                opened = opened.Count(r => r.ProductId == p.Id),
                started = started.Count(r => r.ProductId == p.Id),
                participants = seats.Count(s => s.ProductId == p.Id),
            }),
            referrals = new
            {
                visits = clicks.Count,
                purchases = linkPurchases.Count,
                freeGames = linkFree.Count,
                links = links.Select(l => new
                {
                    id = l.Id, name = (l.FirstName + " " + l.LastName).Trim(),
                    visits = clicks.Count(c => c.ReferralLinkId == l.Id),
                    purchases = linkPurchases.Count(o => o.ReferralLinkId == l.Id),
                    freeGames = linkFree.Count(r => r.ReferralLinkId == l.Id),
                }).OrderByDescending(x => x.purchases).ThenByDescending(x => x.freeGames).ThenByDescending(x => x.visits).ToList(),
            },
            series,
        };
    }
}
