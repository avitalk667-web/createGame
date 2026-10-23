using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Payments;

/// <summary>What a coupon does to one product's price — always computed here, never taken from the browser.</summary>
public sealed record CouponQuote(Guid CouponId, string Code, CouponKind Kind, decimal Value, decimal OriginalPrice, decimal Discount, decimal FinalPrice);

public sealed record CouponInput(
    string? Code, string? Name, string? Note, string? Kind, decimal? Value, List<string>? ProductIds,
    DateTime? StartsAt, DateTime? EndsAt, int? MaxRedemptions, bool? Active);

/// <summary>
/// Discount coupons (spec 4): validation, pricing, and the reservation of a use while an order waits for payment.
/// The use is checked and reserved under a row lock on the coupon, so two buyers paying at the same moment can
/// never both take the last use.
/// </summary>
public sealed class CouponService(PortalDbContext db)
{
    /// <summary>How long a pending order holds a coupon use before it returns to the pool.</summary>
    public static readonly TimeSpan ReservationTime = TimeSpan.FromMinutes(30);

    /// <summary>The smallest amount ever charged: a coupon never makes a paid game free or negative.</summary>
    public const decimal MinimumCharge = 1m;

    public const string UnknownMessage = "קוד הקופון שהזנת אינו קיים או אינו פעיל.";
    public const string ExpiredMessage = "תוקף הקופון הסתיים.";
    public const string WrongProductMessage = "קוד הקופון אינו תקף למשחק שבחרת.";
    public const string NotStartedMessage = "הקופון עדיין לא בתוקף.";
    public const string UsedUpMessage = "הקופון כבר נוצל עד המכסה שלו.";

    public static string Normalize(string? code) => (code ?? "").Trim().ToUpperInvariant();

    /// <summary>Discount and final price for a catalog price; rounded to agorot, never below the minimum charge.</summary>
    public static (decimal Discount, decimal Final) Price(decimal price, CouponKind kind, decimal value)
    {
        var discount = kind == CouponKind.Percent
            ? decimal.Round(price * value / 100m, 2, MidpointRounding.AwayFromZero)
            : value;
        discount = Math.Clamp(discount, 0m, Math.Max(0m, price - MinimumCharge));
        return (discount, price - discount);
    }

    public static string State(Coupon c, DateTime now) =>
        !c.Active ? "disabled" : c.StartsAt is { } s && s > now ? "scheduled" : c.EndsAt is { } e && e <= now ? "expired" : "active";

    /// <summary>Uses that count against the limit: paid ones and reservations that have not expired.</summary>
    private IQueryable<CouponRedemption> Counting(Guid couponId, DateTime now) =>
        db.CouponRedemptions.Where(r => r.CouponId == couponId
            && (r.Status == RedemptionStatus.Redeemed || (r.Status == RedemptionStatus.Reserved && r.ReservedUntil > now)));

    /// <summary>Checks a code for a product and prices it. Errors carry the exact messages of the spec.</summary>
    public async Task<(CouponQuote? Quote, ServiceError? Error)> QuoteAsync(string? code, Product product, DateTime now)
    {
        if (product.IsFree) return (null, new ServiceError(400, "free-product", "המשחק הזה חינמי — אין צורך בקופון."));
        if (product.PriceIls is not > 0) return (null, new ServiceError(409, "no-price", "למשחק הזה עדיין אין מחיר."));
        var normalized = Normalize(code);
        if (normalized.Length == 0) return (null, new ServiceError(400, "no-code", "הזינו קוד קופון."));
        var c = await db.Coupons.AsNoTracking().Include(x => x.Products).FirstOrDefaultAsync(x => x.Code == normalized);
        if (c == null || !c.Active) return (null, new ServiceError(404, "unknown", UnknownMessage));
        if (c.EndsAt is { } end && end <= now) return (null, new ServiceError(410, "expired", ExpiredMessage));
        if (c.StartsAt is { } start && start > now) return (null, new ServiceError(409, "not-started", NotStartedMessage));
        if (c.Products.All(p => p.ProductId != product.Id)) return (null, new ServiceError(409, "wrong-product", WrongProductMessage));
        if (c.MaxRedemptions is { } max && await Counting(c.Id, now).CountAsync() >= max)
            return (null, new ServiceError(409, "used-up", UsedUpMessage));
        var price = product.PriceIls.Value;
        var (discount, final) = Price(price, c.Kind, c.Value);
        return (new CouponQuote(c.Id, c.Code, c.Kind, c.Value, price, discount, final), null);
    }

    /// <summary>
    /// Reserves one use for an order, inside the caller's transaction. The coupon row is locked first, then the
    /// limit is checked again, so the last use cannot be taken twice.
    /// </summary>
    public async Task<ServiceError?> ReserveAsync(CouponQuote quote, Order order, DateTime now)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"Coupons\" WHERE \"Id\" = {quote.CouponId} FOR UPDATE");
        var c = await db.Coupons.AsNoTracking().FirstAsync(x => x.Id == quote.CouponId);
        if (!c.Active) return new ServiceError(404, "unknown", UnknownMessage);
        if (c.MaxRedemptions is { } max && await Counting(c.Id, now).CountAsync() >= max)
            return new ServiceError(409, "used-up", UsedUpMessage);
        db.CouponRedemptions.Add(new CouponRedemption
        {
            Id = Guid.NewGuid(), CouponId = c.Id, OrderId = order.Id, ProductId = order.ProductId,
            OriginalPrice = quote.OriginalPrice, Discount = quote.Discount, FinalPrice = quote.FinalPrice,
            Status = RedemptionStatus.Reserved, CreatedAt = now, UpdatedAt = now, ReservedUntil = now + ReservationTime,
        });
        return null;
    }

    /// <summary>Moves the order's coupon use along with the payment (paid → redeemed, failed → released, refund → refunded).</summary>
    public async Task UpdateForOrderAsync(Guid orderId, OrderStatus status, DateTime now)
    {
        var r = await db.CouponRedemptions.FirstOrDefaultAsync(x => x.OrderId == orderId);
        if (r == null) return;
        r.Status = status switch
        {
            OrderStatus.Paid => RedemptionStatus.Redeemed,
            OrderStatus.Refunded => RedemptionStatus.Refunded,
            OrderStatus.Failed or OrderStatus.Cancelled => RedemptionStatus.Released,
            _ => r.Status,
        };
        r.UpdatedAt = now;
    }

    // ------------------------------------------------------------------ administration

    private static readonly Regex CodePattern = new("^[A-Z0-9_-]{3,32}$", RegexOptions.Compiled);

    public async Task<string?> ApplyAsync(Coupon c, CouponInput u, bool creating)
    {
        if (creating || u.Code != null)
        {
            var code = Normalize(u.Code);
            if (!CodePattern.IsMatch(code)) return "קוד הקופון צריך להכיל 3–32 אותיות באנגלית, ספרות, מקף או קו תחתון.";
            if (await db.Coupons.AnyAsync(x => x.Code == code && x.Id != c.Id)) return "קוד הקופון הזה כבר קיים. בחרו קוד אחר.";
            c.Code = code;
        }
        if (creating || u.Name != null)
        {
            var name = (u.Name ?? "").Trim();
            if (name.Length is < 2 or > 80) return "השם הפנימי צריך להיות באורך 2–80 תווים.";
            c.Name = name;
        }
        if (u.Note != null)
        {
            if (u.Note.Length > 500) return "ההערה ארוכה מדי (עד 500 תווים).";
            c.Note = u.Note.Trim().Length == 0 ? null : u.Note.Trim();
        }
        if (creating || u.Kind != null)
        {
            if (!Enum.TryParse<CouponKind>(u.Kind, true, out var kind)) return "בחרו סוג הנחה: אחוזים או סכום קבוע.";
            c.Kind = kind;
        }
        if (creating || u.Value != null)
        {
            var v = u.Value ?? 0;
            if (decimal.Round(v, 2) != v) return "ערך ההנחה יכול לכלול עד שתי ספרות אחרי הנקודה.";
            if (c.Kind == CouponKind.Percent && v is <= 0 or >= 100) return "הנחה באחוזים צריכה להיות בין 1 ל־99.";
            if (c.Kind == CouponKind.Fixed && v is <= 0 or > 10000) return "הנחה בסכום קבוע צריכה להיות סכום חיובי בשקלים.";
            c.Value = v;
        }
        if (creating || u.ProductIds != null)
        {
            var ids = (u.ProductIds ?? []).Distinct().ToList();
            if (ids.Count == 0) return "בחרו לפחות משחק אחד שעליו חל הקופון.";
            var products = await db.Products.AsNoTracking().Where(p => ids.Contains(p.Id)).ToListAsync();
            if (products.Count != ids.Count) return "אחד המשחקים שנבחרו לא נמצא.";
            if (products.Any(p => p.IsFree)) return "אי אפשר לשייך קופון למשחק חינמי.";
            var fixedTooBig = c.Kind == CouponKind.Fixed ? products.FirstOrDefault(p => p.PriceIls is { } price && c.Value >= price) : null;
            if (fixedTooBig != null) return $"ההנחה גבוהה ממחיר המשחק „{fixedTooBig.Name}”. המחיר הסופי חייב להישאר חיובי.";
            c.Products.RemoveAll(p => !ids.Contains(p.ProductId));
            foreach (var id in ids.Where(id => c.Products.All(p => p.ProductId != id)))
                c.Products.Add(new CouponProduct { CouponId = c.Id, ProductId = id });
        }
        if (creating || u.StartsAt != null || u.EndsAt != null)
        {
            c.StartsAt = u.StartsAt ?? (creating ? null : c.StartsAt);
            c.EndsAt = u.EndsAt ?? (creating ? null : c.EndsAt);
            if (c.StartsAt is { } s && c.EndsAt is { } e && e <= s) return "מועד הסיום חייב להיות אחרי מועד ההתחלה.";
        }
        if (u.MaxRedemptions != null || creating)
        {
            if (u.MaxRedemptions is < 0 or > 1_000_000) return "מספר המימושים המרבי אינו תקין.";
            c.MaxRedemptions = u.MaxRedemptions is null or 0 ? null : u.MaxRedemptions;
        }
        if (u.Active != null) c.Active = u.Active.Value;
        return null;
    }

    /// <summary>Every coupon with its usage, for the admin report (spec 4.9).</summary>
    public async Task<object> ReportAsync(DateTime now)
    {
        var coupons = await db.Coupons.AsNoTracking().Include(c => c.Products).OrderByDescending(c => c.CreatedAt).ToListAsync();
        var uses = await db.CouponRedemptions.AsNoTracking().ToListAsync();
        var names = await db.Products.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name);
        return coupons.Select(c =>
        {
            var mine = uses.Where(u => u.CouponId == c.Id).ToList();
            var paid = mine.Where(u => u.Status == RedemptionStatus.Redeemed).ToList();
            return new
            {
                c.Id, c.Code, c.Name, c.Note, kind = c.Kind.ToString().ToLowerInvariant(), c.Value,
                products = c.Products.Select(p => new { id = p.ProductId, name = names.GetValueOrDefault(p.ProductId, p.ProductId) }),
                c.StartsAt, c.EndsAt, c.MaxRedemptions, c.Active, c.CreatedAt, c.UpdatedAt,
                state = State(c, now),
                redeemed = paid.Count,
                reserved = mine.Count(u => u.Status == RedemptionStatus.Reserved && u.ReservedUntil > now),
                refunded = mine.Count(u => u.Status == RedemptionStatus.Refunded),
                discountGiven = paid.Sum(u => u.Discount),
                paidTotal = paid.Sum(u => u.FinalPrice),
            };
        }).ToList();
    }
}
