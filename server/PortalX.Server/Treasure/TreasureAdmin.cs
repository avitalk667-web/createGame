using System.Text;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Admin;
using PortalX.Server.Challenge;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Mail;
using PortalX.Server.Payments;

namespace PortalX.Server.Treasure;

/// <summary>
/// The admin's "תיבת האוצר" tab: settings, the gift list, the business numbers and the history of draws. Test orders are
/// left out unless asked for, like everywhere else in the admin area.
/// </summary>
public sealed class TreasureAdmin(PortalDbContext db, TreasureService treasure, ScenarioCatalog scenarios)
{
    public async Task<object> ConfigAsync()
    {
        var c = await treasure.ActiveConfigAsync();
        var history = await db.TreasureConfigs.AsNoTracking().OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Take(10)
            .Select(x => new { x.Id, x.Enabled, x.CreatedBy, x.CreatedAt, x.IsActive }).ToListAsync();
        var given = await db.TreasureWins.AsNoTracking().Where(w => w.Status != TreasureWinStatus.Revoked && w.Status != TreasureWinStatus.NoPrize)
            .GroupBy(w => w.PrizeKey).Select(g => new { key = g.Key, count = g.Count(), cost = g.Sum(w => w.CostIls) }).ToListAsync();
        return new
        {
            c.Id, c.Enabled, c.FallbackKey, prizes = TreasureService.Prizes(c), c.CreatedAt, c.CreatedBy,
            totalWeight = TreasureRules.TotalWeight, kinds = TreasureKinds.All, animations = TreasureAnimations.All, given, history,
        };
    }

    public async Task<object> GiftProductsAsync()
    {
        var listed = await db.TreasureGiftProducts.AsNoTracking().ToDictionaryAsync(g => g.ProductId);
        var products = await db.Products.AsNoTracking().Where(p => !p.IsFree).OrderBy(p => p.SortOrder).ToListAsync();
        return products.Select(p => new
        {
            p.Id, p.Name, p.CoverImage, p.PriceIls, status = p.Status.ToString().ToLowerInvariant(),
            playable = PurchaseService.IsPlayable(p, scenarios),
            selected = listed.ContainsKey(p.Id), addedAt = listed.GetValueOrDefault(p.Id)?.AddedAt,
        });
    }

    public async Task<string?> SetGiftAsync(string productId, bool selected, string admin)
    {
        var p = await db.Products.AsNoTracking().FirstOrDefaultAsync(x => x.Id == productId);
        if (p == null) return "המשחק לא נמצא.";
        if (p.IsFree) return "משחק חינמי אינו יכול להיות מתנה.";
        var row = await db.TreasureGiftProducts.FirstOrDefaultAsync(g => g.ProductId == productId);
        if (selected && row == null) db.TreasureGiftProducts.Add(new TreasureGiftProduct { ProductId = productId, AddedBy = admin, AddedAt = DateTime.UtcNow });
        if (!selected && row != null) db.TreasureGiftProducts.Remove(row);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); /* the same click arrived twice: the row is already as asked */ }
        return null;
    }

    // ------------------------------------------------------------------ numbers

    private sealed record Row(TreasureWin Win, Order Order, Coupon? Coupon, CouponRedemption? Use, Order? UseOrder, Entitlement? Ent, string? GiftName);

    private async Task<List<Row>> RowsAsync(AdminFilter f)
    {
        var q = db.TreasureWins.AsNoTracking().Join(db.Orders.AsNoTracking(), w => w.OrderId, o => o.Id, (w, o) => new { w, o });
        if (!f.IncludeTest) q = q.Where(x => !x.w.IsTest);
        if (f.From is { } from) q = q.Where(x => x.w.CreatedAt >= from);
        if (f.To is { } to) q = q.Where(x => x.w.CreatedAt < to);
        if (f.ProductId != null) q = q.Where(x => x.o.ProductId == f.ProductId);
        var list = await q.OrderByDescending(x => x.w.CreatedAt).ToListAsync();

        var couponIds = list.Where(x => x.w.CouponId != null).Select(x => x.w.CouponId!.Value).ToList();
        var coupons = await db.Coupons.AsNoTracking().Where(c => couponIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id);
        var uses = await db.CouponRedemptions.AsNoTracking().Where(r => couponIds.Contains(r.CouponId))
            .OrderByDescending(r => r.Status == RedemptionStatus.Redeemed).ThenByDescending(r => r.CreatedAt).ToListAsync();
        var useOrderIds = uses.Select(u => u.OrderId).ToList();
        var useOrders = await db.Orders.AsNoTracking().Where(o => useOrderIds.Contains(o.Id)).ToDictionaryAsync(o => o.Id);
        var entIds = list.Where(x => x.w.EntitlementId != null).Select(x => x.w.EntitlementId!.Value).ToList();
        var ents = await db.Entitlements.AsNoTracking().Where(e => entIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id);
        var names = await db.Products.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name);

        var rows = list.Select(x =>
        {
            var use = x.w.CouponId is { } cid ? uses.FirstOrDefault(u => u.CouponId == cid) : null;
            return new Row(x.w, x.o, x.w.CouponId is { } c ? coupons.GetValueOrDefault(c) : null, use,
                use == null ? null : useOrders.GetValueOrDefault(use.OrderId),
                x.w.EntitlementId is { } e ? ents.GetValueOrDefault(e) : null,
                x.w.GiftProductId == null ? null : names.GetValueOrDefault(x.w.GiftProductId));
        });
        if (f.Status != null)
            rows = rows.Where(r => f.Status switch
            {
                "won" => r.Win.PrizeKind != TreasureKinds.None,
                "none" => r.Win.PrizeKind == TreasureKinds.None,
                "coupon" => r.Win.CouponId != null,
                "gift" => r.Win.EntitlementId != null,
                "redeemed" => r.Use?.Status == RedemptionStatus.Redeemed,
                "revoked" => r.Win.Status == TreasureWinStatus.Revoked,
                "fallback" => r.Win.IsFallback,
                _ => r.Win.PrizeKey == f.Status,
            });
        if (f.Search is { } s)
        {
            var needle = s.Trim().ToLowerInvariant().TrimStart('#');
            rows = rows.Where(r => r.Order.Number.ToString() == needle
                || (r.Win.Email ?? r.Order.Email ?? "").ToLowerInvariant().Contains(needle)
                || (r.Coupon?.Code ?? "").ToLowerInvariant() == needle);
        }
        return rows.ToList();
    }

    private static string CouponStatus(Row r, DateTime now) =>
        r.Coupon == null ? "" : ChallengeRules.Status(r.Coupon, r.Use?.Status == RedemptionStatus.Redeemed, now);

    private static string GiftStatus(Row r) =>
        r.Ent == null ? "" : r.Ent.Revoked ? "revoked" : r.Ent.SessionsUsed > 0 ? "opened" : "granted";

    public async Task<object> StatsAsync(AdminFilter f)
    {
        var rows = await RowsAsync(f with { Status = null, Search = null });
        var now = DateTime.UtcNow;
        var won = rows.Where(r => r.Win.PrizeKind != TreasureKinds.None).ToList();
        var coupons = rows.Where(r => r.Coupon != null).ToList();
        var redeemed = coupons.Where(r => r.Use?.Status == RedemptionStatus.Redeemed && r.UseOrder?.Status == OrderStatus.Paid).ToList();
        var gifts = rows.Where(r => r.Ent != null).ToList();
        var giftCost = gifts.Where(r => r.Win.Status != TreasureWinStatus.Revoked).Sum(r => r.Win.CostIls);
        var discountGiven = redeemed.Sum(r => r.Use!.Discount);

        // repeat purchases: a later paid order by the same address — with the prize coupon, or without it
        var emails = rows.Where(r => r.Win.Email != null).Select(r => r.Win.Email!).Distinct().ToList();
        var later = emails.Count == 0 ? [] : await db.Orders.AsNoTracking()
            .Where(o => o.Status == OrderStatus.Paid && o.Email != null && emails.Contains(o.Email.ToLower()) && (f.IncludeTest || !o.IsTest))
            .Select(o => new { o.Id, Email = o.Email!.ToLower(), o.PaidAt, o.PriceSnapshot, o.CouponId }).ToListAsync();
        var treasureCoupons = coupons.Select(r => r.Coupon!.Id).ToHashSet();
        var repeats = rows.Where(r => r.Win.Email != null)
            .Select(r => new { r, next = later.Where(o => o.Email == r.Win.Email && o.Id != r.Win.OrderId && o.PaidAt > r.Win.CreatedAt).OrderBy(o => o.PaidAt).FirstOrDefault() })
            .Where(x => x.next != null).ToList();
        var repeatOrders = later.Where(o => rows.Any(r => r.Win.Email == o.Email && o.Id != r.Win.OrderId && o.PaidAt > r.Win.CreatedAt)).ToList();
        var withCoupon = repeatOrders.Where(o => o.CouponId is { } c && treasureCoupons.Contains(c)).ToList();
        var withoutCoupon = repeatOrders.Except(withCoupon).ToList();
        var winsWithRepeat = repeats.Where(x => x.r.Win.PrizeKind != TreasureKinds.None).ToList();

        return new
        {
            participated = rows.Count,
            wins = won.Count,
            winRate = rows.Count == 0 ? 0 : Math.Round(100m * won.Count / rows.Count, 2),
            byPrize = rows.GroupBy(r => r.Win.PrizeKey).Select(g => new { key = g.Key, count = g.Count(), fallback = g.Count(r => r.Win.IsFallback) }).OrderByDescending(g => g.count),
            fallbacks = rows.Count(r => r.Win.IsFallback),
            couponsCreated = coupons.Count,
            couponsRedeemed = redeemed.Count,
            couponsExpired = coupons.Count(r => CouponStatus(r, now) == "expired"),
            redemptionRate = coupons.Count == 0 ? 0 : Math.Round(100m * redeemed.Count / coupons.Count, 2),
            giftsGranted = gifts.Count(r => r.Win.Status != TreasureWinStatus.Revoked),
            giftsOpened = gifts.Count(r => r.Ent!.SessionsUsed > 0),
            revoked = rows.Count(r => r.Win.Status == TreasureWinStatus.Revoked),
            // actual cost: the catalog price of the gift games given, plus the discounts of the coupons used
            totalCost = giftCost + discountGiven,
            giftCost, discountGiven,
            // the most all issued prizes could still cost (every coupon used on the most expensive game)
            committedCost = rows.Where(r => r.Win.Status != TreasureWinStatus.Revoked).Sum(r => r.Win.CostIls),
            couponRevenue = redeemed.Sum(r => r.Use!.FinalPrice),
            repeatWithCoupon = withCoupon.Count,
            repeatWithCouponRevenue = withCoupon.Sum(o => o.PriceSnapshot),
            repeatWithoutCoupon = withoutCoupon.Count,
            repeatWithoutCouponRevenue = withoutCoupon.Sum(o => o.PriceSnapshot),
            avgHoursToRepeat = winsWithRepeat.Count == 0 ? (double?)null
                : Math.Round(winsWithRepeat.Average(x => (x.next!.PaidAt!.Value - x.r.Win.CreatedAt).TotalHours), 1),
            unrevealed = won.Count(r => r.Win.RevealedAt == null),
            withoutEmail = rows.Count(r => r.Win.Email == null),
        };
    }

    public async Task<object> WinsAsync(AdminFilter f)
    {
        var now = DateTime.UtcNow;
        var rows = await RowsAsync(f);
        return new
        {
            total = rows.Count,
            rows = rows.Take(500).Select(r => new
            {
                id = r.Win.Id, at = r.Win.CreatedAt, orderId = r.Order.Id, orderNumber = r.Order.Number, game = r.Order.ProductName,
                email = r.Win.Email ?? r.Order.Email, prizeKey = r.Win.PrizeKey, prizeKind = r.Win.PrizeKind, drawnKey = r.Win.DrawnKey,
                r.Win.IsFallback, r.Win.FallbackReason, status = r.Win.Status.ToString().ToLowerInvariant(), r.Win.IsTest,
                revealedAt = r.Win.RevealedAt, couponCode = r.Coupon?.Code, couponPercent = r.Coupon?.Value, couponExpiresAt = r.Coupon?.EndsAt,
                couponStatus = CouponStatus(r, now), redeemedOrderNumber = r.Use?.Status == RedemptionStatus.Redeemed ? r.UseOrder?.Number : null,
                giftGame = r.GiftName, giftStatus = GiftStatus(r), cost = r.Win.CostIls, configId = r.Win.ConfigId,
            }),
        };
    }

    public async Task<string> WinsCsvAsync(AdminFilter f)
    {
        var now = DateTime.UtcNow;
        var rows = await RowsAsync(f);
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", new[] { "תאריך", "מספר הזמנה", "משחק שנרכש", "דוא״ל", "פרס", "גיבוי", "קוד קופון", "אחוז", "תוקף", "סטטוס קופון",
            "מומש בהזמנה", "משחק מתנה", "סטטוס מתנה", "נחשף", "עלות", "בדיקה" }.Select(CsvText.Cell)));
        foreach (var r in rows)
            sb.AppendLine(string.Join(",", new object?[]
            {
                r.Win.CreatedAt, r.Order.Number, r.Order.ProductName, r.Win.Email ?? r.Order.Email, r.Win.PrizeKey, r.Win.IsFallback ? r.Win.FallbackReason : "",
                r.Coupon?.Code, r.Coupon?.Value, r.Coupon?.EndsAt, CouponStatus(r, now),
                r.Use?.Status == RedemptionStatus.Redeemed ? r.UseOrder?.Number : null, r.GiftName, GiftStatus(r), r.Win.RevealedAt != null, r.Win.CostIls, r.Win.IsTest,
            }.Select(CsvText.Cell)));
        return sb.ToString();
    }
}
