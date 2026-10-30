using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Payments;

namespace PortalX.Server.Admin;

public sealed record FaqInput(string? Question, string? Answer, bool? Published, int? SortOrder);
public sealed record CouponStatusRequest(bool Active);

/// <summary>Admin screens added by the extensions spec: FAQ questions and discount coupons. Mapped on the secured group.</summary>
public static class AdminContentEndpoints
{
    /// <summary>Plain text: control characters are removed; HTML is kept as text and never rendered as markup.</summary>
    private static string Clean(string? s) => new string((s ?? "").Where(ch => !char.IsControl(ch) || ch == '\n').ToArray()).Trim();

    private static string? ValidateFaq(string q, string a) =>
        q.Length is < 3 or > 300 ? "השאלה צריכה להיות באורך 3–300 תווים."
        : a.Length is < 3 or > 3000 ? "התשובה צריכה להיות באורך 3–3000 תווים." : null;

    public static void MapAdminContentEndpoints(this RouteGroupBuilder secured)
    {
        // ------------------------------------------------------------------ FAQ (spec 2.4)

        // all the questions the home page can show — the ones the site shipped with included — each editable and deletable
        secured.MapGet("/faq", async (PortalDbContext db) => Results.Ok(new
        {
            custom = await db.Faq.AsNoTracking().OrderBy(f => f.SortOrder).ThenBy(f => f.CreatedAt).ToListAsync(),
        }));

        secured.MapPost("/faq", async (FaqInput u, HttpContext ctx, PortalDbContext db, AdminService s) =>
        {
            var q = Clean(u.Question);
            var a = Clean(u.Answer);
            if (ValidateFaq(q, a) is { } err) return Results.BadRequest(new ApiError("invalid", err));
            var now = DateTime.UtcNow;
            var next = (await db.Faq.MaxAsync(f => (int?)f.SortOrder) ?? 0) + 1;
            var entry = new FaqEntry
            {
                Id = Guid.NewGuid(), Question = q, Answer = a, Published = u.Published ?? true, SortOrder = u.SortOrder ?? next,
                CreatedBy = AdminAuth.Name(ctx.User), CreatedAt = now, UpdatedAt = now,
            };
            db.Faq.Add(entry);
            await db.SaveChangesAsync();
            await s.AuditAsync(AdminAuth.Name(ctx.User), "faq-added", "faq", entry.Id.ToString(), new { q });
            return Results.Ok(entry);
        });

        secured.MapPut("/faq/{id:guid}", async (Guid id, FaqInput u, HttpContext ctx, PortalDbContext db, AdminService s) =>
        {
            var entry = await db.Faq.FirstOrDefaultAsync(f => f.Id == id);
            if (entry == null) return Results.NotFound(new ApiError("no-faq", "השאלה לא נמצאה."));
            var q = u.Question != null ? Clean(u.Question) : entry.Question;
            var a = u.Answer != null ? Clean(u.Answer) : entry.Answer;
            if (ValidateFaq(q, a) is { } err) return Results.BadRequest(new ApiError("invalid", err));
            entry.Question = q;
            entry.Answer = a;
            if (u.Published is { } pub) entry.Published = pub;
            if (u.SortOrder is { } order) entry.SortOrder = order;
            entry.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            await s.AuditAsync(AdminAuth.Name(ctx.User), "faq-updated", "faq", id.ToString(), new { entry.Published, entry.SortOrder });
            return Results.Ok(entry);
        });

        secured.MapDelete("/faq/{id:guid}", async (Guid id, HttpContext ctx, PortalDbContext db, AdminService s) =>
        {
            var entry = await db.Faq.FirstOrDefaultAsync(f => f.Id == id);
            if (entry == null) return Results.NotFound(new ApiError("no-faq", "השאלה לא נמצאה."));
            db.Faq.Remove(entry);
            await db.SaveChangesAsync();
            await s.AuditAsync(AdminAuth.Name(ctx.User), "faq-deleted", "faq", id.ToString(), new { entry.Question });
            return Results.Ok(new { deleted = true });
        });

        // ------------------------------------------------------------------ coupons (spec 4.2–4.9)

        secured.MapGet("/coupons", async (CouponService c) => Results.Ok(await c.ReportAsync(DateTime.UtcNow)));

        secured.MapPost("/coupons", async (CouponInput u, HttpContext ctx, PortalDbContext db, CouponService c, AdminService s) =>
        {
            var now = DateTime.UtcNow;
            var coupon = new Coupon { Id = Guid.NewGuid(), Active = u.Active ?? true, CreatedAt = now, UpdatedAt = now };
            if (await c.ApplyAsync(coupon, u, creating: true) is { } err) return Results.BadRequest(new ApiError("invalid", err));
            db.Coupons.Add(coupon);
            await db.SaveChangesAsync();
            await s.AuditAsync(AdminAuth.Name(ctx.User), "coupon-created", "coupon", coupon.Code,
                new { coupon.Kind, coupon.Value, products = coupon.Products.Select(p => p.ProductId), coupon.MaxRedemptions });
            return Results.Ok(new { coupon.Id, coupon.Code });
        });

        secured.MapPut("/coupons/{id:guid}", async (Guid id, CouponInput u, HttpContext ctx, PortalDbContext db, CouponService c, AdminService s) =>
        {
            var coupon = await db.Coupons.Include(x => x.Products).FirstOrDefaultAsync(x => x.Id == id);
            if (coupon == null) return Results.NotFound(new ApiError("no-coupon", "הקופון לא נמצא."));
            if (await c.ApplyAsync(coupon, u, creating: false) is { } err) return Results.BadRequest(new ApiError("invalid", err));
            coupon.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            await s.AuditAsync(AdminAuth.Name(ctx.User), "coupon-updated", "coupon", coupon.Code,
                new { coupon.Kind, coupon.Value, products = coupon.Products.Select(p => p.ProductId), coupon.MaxRedemptions, coupon.Active });
            return Results.Ok(new { coupon.Id, coupon.Code });
        });

        // switching a coupon off stops new uses only; past orders and their discount history stay as they were
        secured.MapPost("/coupons/{id:guid}/status", async (Guid id, CouponStatusRequest req, HttpContext ctx, PortalDbContext db, AdminService s) =>
        {
            var coupon = await db.Coupons.FirstOrDefaultAsync(x => x.Id == id);
            if (coupon == null) return Results.NotFound(new ApiError("no-coupon", "הקופון לא נמצא."));
            coupon.Active = req.Active;
            coupon.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            await s.AuditAsync(AdminAuth.Name(ctx.User), req.Active ? "coupon-enabled" : "coupon-disabled", "coupon", coupon.Code);
            return Results.Ok(new { coupon.Id, coupon.Active });
        });

        secured.MapGet("/coupons/{id:guid}/orders", async (Guid id, PortalDbContext db) =>
        {
            var uses = await db.CouponRedemptions.AsNoTracking().Where(r => r.CouponId == id).OrderByDescending(r => r.CreatedAt).ToListAsync();
            var orderIds = uses.Select(u => u.OrderId).ToList();
            var orders = await db.Orders.AsNoTracking().Where(o => orderIds.Contains(o.Id)).ToDictionaryAsync(o => o.Id);
            return Results.Ok(uses.Select(u =>
            {
                var o = orders.GetValueOrDefault(u.OrderId);
                return new
                {
                    orderNumber = o?.Number, productName = o?.ProductName, u.ProductId, u.OriginalPrice, u.Discount, u.FinalPrice,
                    redemption = u.Status.ToString().ToLowerInvariant(), orderStatus = o?.Status.ToString().ToLowerInvariant(),
                    isTest = o?.IsTest, u.CreatedAt,
                };
            }));
        });
    }
}
