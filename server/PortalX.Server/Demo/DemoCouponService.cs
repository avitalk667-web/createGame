using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Challenge;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Demo;

public sealed record TasteCouponInput(bool? IsActive, decimal? DiscountPercentage, int? ValidityDays, int? MaxCoupons, List<string>? ProductIds);

/// <summary>The personal coupon of a finished taste, as its browser sees it. The expiry and "now" are the server's.</summary>
public sealed record TasteCouponView(
    string Code, decimal DiscountPercent, DateTime IssuedAt, DateTime ExpiresAt, string ExpiresAtText, int ValidityDays,
    string Status, DateTime ServerNow, List<string> ProductIds);

/// <summary>
/// The reward of finishing "טעימה מהפורטל": one personal coupon per finished taste session (10% for 8 days by default),
/// issued only by the server and only after the server itself recorded the right code. It is an ordinary coupon of a
/// campaign of kind "taste" — the same table, checkout, reservation and redemption as the coupons of "Challenge 240", with
/// settings of its own — so the discount is priced and the use is taken only when a payment is confirmed. A refresh, a
/// second tab or two requests at once get the same coupon (the session's coupon is unique in the database).
/// </summary>
public sealed class DemoCouponService(PortalDbContext db, DemoService demo)
{
    public const string Name = "טעימה מהפורטל";

    /// <summary>The settings of the taste coupons; created the first time with the spec's defaults (on, 10%, 8 days, every paid game).</summary>
    public async Task<CouponCampaign> CampaignAsync()
    {
        var c = await db.CouponCampaigns.Include(x => x.Products).FirstOrDefaultAsync(x => x.Kind == CampaignKinds.Taste);
        if (c != null) return c;
        var free = await db.Products.AsNoTracking().Where(p => p.IsFree).OrderBy(p => p.Id == "gate-of-secrets" ? 0 : 1).ThenBy(p => p.SortOrder)
            .Select(p => p.Id).FirstOrDefaultAsync() ?? throw new InvalidOperationException("no free game in the catalog");
        var paid = await db.Products.AsNoTracking().Where(p => !p.IsFree && p.Status == ProductStatus.Published).Select(p => p.Id).ToListAsync();
        var now = DateTime.UtcNow;
        var id = Guid.NewGuid();
        c = new CouponCampaign
        {
            Id = id, Kind = CampaignKinds.Taste, Name = Name,
            Description = "מי שמסיים את הטעימה החינמית מקבל קופון אישי של הנחה על משחק מלא.",
            IsActive = true, DiscountPercentage = 10, ValidityDays = 8, MaxCoupons = 0,
            // the column needs a real game; the taste coupons never read it
            SourceProductId = free, ShowEntryPopup = false, ShowProgress = false, StartedAt = now, CreatedAt = now, UpdatedAt = now,
            Products = paid.Select(p => new CouponCampaignProduct { CampaignId = id, ProductId = p }).ToList(),
        };
        db.CouponCampaigns.Add(c);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return await db.CouponCampaigns.Include(x => x.Products).FirstAsync(x => x.Kind == CampaignKinds.Taste);
        }
        return c;
    }

    private async Task<TasteCouponView> ViewAsync(Coupon k, DateTime now)
    {
        var redeemed = await db.CouponRedemptions.AnyAsync(r => r.CouponId == k.Id && r.Status == RedemptionStatus.Redeemed);
        var products = k.Products.Count > 0 ? k.Products.Select(p => p.ProductId).ToList()
            : await db.CouponProducts.AsNoTracking().Where(p => p.CouponId == k.Id).Select(p => p.ProductId).ToListAsync();
        var issued = k.StartsAt ?? k.CreatedAt;
        return new TasteCouponView(k.Code, k.Value, issued, k.EndsAt!.Value, ChallengeRules.FormatIsrael(k.EndsAt.Value),
            (int)Math.Round((k.EndsAt.Value - issued).TotalDays), ChallengeRules.Status(k, redeemed, now), now, products);
    }

    /// <summary>
    /// The coupon of this browser's finished taste: the one already issued, or a new one. Null with a reason when there is
    /// none: "no-session", "not-completed", "inactive" (switched off, paused or no games) or "limit" (the quota is used up).
    /// </summary>
    public async Task<(TasteCouponView? Coupon, string? Reason)> IssueAsync(string? token, DateTime now)
    {
        var s = await demo.FindAsync(token, now);
        if (s == null) return (null, "no-session");
        if (s.CompletedAt == null) return (null, "not-completed");
        for (var attempt = 0; ; attempt++)
        {
            var existing = await db.Coupons.AsNoTracking().Include(k => k.Products).FirstOrDefaultAsync(k => k.DemoSessionId == s.Id);
            if (existing != null) return (await ViewAsync(existing, now), null);
            var campaign = await CampaignAsync();
            if (!campaign.IsActive || campaign.IssuingPaused || campaign.Products.Count == 0) return (null, "inactive");
            try
            {
                return await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
                {
                    db.ChangeTracker.Clear();
                    await using var tx = await db.Database.BeginTransactionAsync();
                    // the campaign's row lock: the quota and the count move together, one coupon at a time
                    await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"CouponCampaigns\" WHERE \"Id\" = {campaign.Id} FOR UPDATE");
                    var c = await db.CouponCampaigns.AsNoTracking().Include(k => k.Products).FirstAsync(k => k.Id == campaign.Id);
                    var again = await db.Coupons.AsNoTracking().Include(k => k.Products).FirstOrDefaultAsync(k => k.DemoSessionId == s.Id);
                    if (again != null) { await tx.RollbackAsync(); return (await ViewAsync(again, now), (string?)null); }
                    if (!c.IsActive || c.IssuingPaused || c.Products.Count == 0) { await tx.RollbackAsync(); return (null, "inactive"); }
                    if (c.MaxCoupons > 0 && c.IssuedCouponsCount >= c.MaxCoupons) { await tx.RollbackAsync(); return (null, "limit"); }
                    var id = Guid.NewGuid();
                    var coupon = new Coupon
                    {
                        Id = id, Code = ChallengeRules.NewCode(), Name = $"{Name} · קופון אישי", Kind = CouponKind.Percent, Value = c.DiscountPercentage,
                        StartsAt = now, EndsAt = ChallengeRules.ExpiresAt(now, c.ValidityDays), MaxRedemptions = 1, Active = true,
                        CreatedAt = now, UpdatedAt = now, CampaignId = c.Id, DemoSessionId = s.Id,
                        Products = c.Products.Select(p => new CouponProduct { CouponId = id, ProductId = p.ProductId }).ToList(),
                    };
                    db.Coupons.Add(coupon);
                    db.CouponEvents.Add(new CouponEvent
                    {
                        CouponId = id, Action = "issued", Actor = "system", At = now,
                        DetailsJson = JsonSerializer.Serialize(new { source = CampaignKinds.Taste, discount = coupon.Value, validityDays = c.ValidityDays }),
                    });
                    db.DemoEvents.Add(new DemoEvent { SessionId = s.Id, Type = "demo_coupon_issued", At = now, Device = s.Device, Variant = s.Variant, ReferralLinkId = s.ReferralLinkId });
                    await db.SaveChangesAsync();
                    await db.CouponCampaigns.Where(k => k.Id == c.Id).ExecuteUpdateAsync(u => u
                        .SetProperty(k => k.IssuedCouponsCount, k => k.IssuedCouponsCount + 1).SetProperty(k => k.UpdatedAt, now));
                    await tx.CommitAsync();
                    return (await ViewAsync(coupon, now), (string?)null);
                });
            }
            catch (DbUpdateException) when (attempt < 2)
            {
                // another request issued this session's coupon first (or, very rarely, the random code was taken): read again
                db.ChangeTracker.Clear();
            }
        }
    }

    // ------------------------------------------------------------------ administration (inside "ניהול אתגר 240 וקופונים")

    private static object Settings(CouponCampaign c) => new
    {
        c.Id, c.IsActive, c.IssuingPaused, c.DiscountPercentage, c.ValidityDays, c.MaxCoupons, c.IssuedCouponsCount,
        productIds = c.Products.Select(p => p.ProductId).OrderBy(x => x).ToList(), c.StartedAt, c.UpdatedAt,
    };

    public async Task<object> AdminViewAsync()
    {
        var c = await CampaignAsync();
        return new { campaign = Settings(c), statistics = await StatisticsAsync(c) };
    }

    /// <summary>A change applies to coupons issued from now on; an issued coupon keeps its discount, games and expiry.</summary>
    public async Task<(string? Error, object? Before, object? After)> UpdateAsync(TasteCouponInput u)
    {
        var c = await CampaignAsync();
        var before = Settings(c);
        if (u.DiscountPercentage is { } pct)
        {
            if (pct is <= 0 or >= 100 || decimal.Round(pct, 2) != pct) return ("אחוז ההנחה צריך להיות בין 1 ל-99.", null, null);
            c.DiscountPercentage = pct;
        }
        if (u.ValidityDays is { } days)
        {
            if (days is < 1 or > 365) return ("תוקף הקופון צריך להיות בין יום אחד ל-365 ימים.", null, null);
            c.ValidityDays = days;
        }
        if (u.MaxCoupons is { } max)
        {
            if (max is < 0 or > 1_000_000) return ("הכמות המרבית אינה תקינה (0 = ללא הגבלה).", null, null);
            c.MaxCoupons = max;
        }
        if (u.ProductIds != null)
        {
            var ids = u.ProductIds.Distinct().ToList();
            if (ids.Count == 0) return ("בחרו לפחות משחק אחד שעליו חלה ההנחה.", null, null);
            var products = await db.Products.AsNoTracking().Where(p => ids.Contains(p.Id)).ToListAsync();
            if (products.Count != ids.Count) return ("אחד המשחקים שנבחרו לא נמצא.", null, null);
            if (products.Any(p => p.IsFree)) return ("אי אפשר לבחור משחק חינמי.", null, null);
            c.Products.RemoveAll(p => !ids.Contains(p.ProductId));
            foreach (var id in ids.Where(id => c.Products.All(p => p.ProductId != id)))
                c.Products.Add(new CouponCampaignProduct { CampaignId = c.Id, ProductId = id });
        }
        if (u.IsActive is { } active)
        {
            c.IsActive = active;
            c.IssuingPaused = false;
        }
        c.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return (null, before, Settings(c));
    }

    /// <summary>The taste coupons' figures. A purchase counts only for a confirmed payment that was not a test.</summary>
    public async Task<object> StatisticsAsync(CouponCampaign c)
    {
        var now = DateTime.UtcNow;
        var since = c.StartedAt ?? c.CreatedAt;
        // the settings are created by the first coupon request, a moment after that visitor opened the door: start from there
        var firstDone = await (from k in db.Coupons.AsNoTracking()
                               where k.CampaignId == c.Id
                               join s in db.DemoSessions.AsNoTracking() on k.DemoSessionId equals s.Id
                               select s.CompletedAt).MinAsync();
        if (firstDone < since) since = firstDone.Value;
        // each step counted by when it happened, so a taste already under way when the coupons began still counts
        var sessions = db.DemoSessions.AsNoTracking();
        var started = await sessions.CountAsync(s => s.CreatedAt >= since || s.CompletedAt >= since);
        var completed = await sessions.CountAsync(s => s.CompletedAt >= since);
        var productClicked = await sessions.CountAsync(s => s.CompletedAt != null && s.ProductClickedAt >= since);
        var checkout = await sessions.CountAsync(s => s.CompletedAt != null && s.CheckoutStartedAt >= since);
        var copied = await db.DemoEvents.AsNoTracking().Where(e => e.Type == "demo_coupon_copied" && e.At >= since && e.SessionId != null)
            .Select(e => e.SessionId).Distinct().CountAsync();
        var coupons = db.Coupons.AsNoTracking().Where(k => k.CampaignId == c.Id);
        var cancelled = await coupons.CountAsync(k => k.CancelledAt != null);
        var uses = await (from r in db.CouponRedemptions.AsNoTracking()
                          join k in coupons on r.CouponId equals k.Id
                          join o in db.Orders.AsNoTracking() on r.OrderId equals o.Id
                          where r.Status == RedemptionStatus.Redeemed
                          select new { r.CouponId, r.ProductId, o.ProductName, o.IsTest, r.Discount, r.FinalPrice }).ToListAsync();
        var real = uses.Where(x => !x.IsTest).ToList();
        var redeemedIds = uses.Select(x => x.CouponId).ToHashSet();
        var redeemed = redeemedIds.Count;
        var expired = await coupons.CountAsync(k => k.CancelledAt == null && k.EndsAt <= now && !redeemedIds.Contains(k.Id));
        static double Pct(int part, int whole) => whole == 0 ? 0 : Math.Round(100.0 * part / whole, 1);
        return new
        {
            since, started, completed, issued = c.IssuedCouponsCount, copied, productClicked, checkoutStarted = checkout,
            redeemed, purchases = real.Count, testRedemptions = uses.Count - real.Count, cancelled, expired,
            active = Math.Max(0, c.IssuedCouponsCount - redeemed - cancelled - expired),
            remaining = c.MaxCoupons == 0 ? (int?)null : Math.Max(0, c.MaxCoupons - c.IssuedCouponsCount),
            revenue = real.Sum(x => x.FinalPrice), discounts = real.Sum(x => x.Discount),
            conversion = Pct(real.Count, completed),
            byGame = real.GroupBy(x => new { x.ProductId, x.ProductName })
                .Select(g => new { productId = g.Key.ProductId, name = g.Key.ProductName, count = g.Count(), revenue = g.Sum(x => x.FinalPrice) })
                .OrderByDescending(g => g.count).ToList(),
        };
    }
}
