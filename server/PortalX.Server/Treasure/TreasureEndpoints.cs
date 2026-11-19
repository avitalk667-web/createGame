using PortalX.Server.Admin;
using PortalX.Server.Mail;
using PortalX.Server.Payments;

namespace PortalX.Server.Treasure;

public sealed record TreasureGiftToggle(bool Selected);

public static class TreasureEndpoints
{
    private static IResult Error(ServiceError e) => Results.Json(new ApiError(e.Code, e.Message), statusCode: e.Status);
    private static readonly ApiError NoOrder = new("no-order", "ההזמנה לא נמצאה. בדקו שהקישור שמור אצלכם במלואו.");

    /// <summary>The buyer's chest. Every call needs the order's secret key; nothing the browser sends decides a prize.</summary>
    public static void MapTreasureEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/orders/{id:guid}/treasure", async (Guid id, HttpRequest http, PurchaseService purchases, TreasureService treasure) =>
            await purchases.FindOrderAsync(id, http.Headers[PurchaseEndpoints.OrderKeyHeader]) is { } order
                ? Results.Ok(await treasure.ViewAsync(order))
                : Results.NotFound(NoOrder)).AddEndpointFilter(PortalX.Server.Security.UsageLimits.Join);

        api.MapPost("/orders/{id:guid}/treasure/reveal", async (Guid id, TreasureRevealRequest? req, HttpRequest http, PurchaseService purchases,
            TreasureService treasure, SiteOptions site) =>
        {
            if (await purchases.FindOrderAsync(id, http.Headers[PurchaseEndpoints.OrderKeyHeader]) is not { } order) return Results.NotFound(NoOrder);
            var (view, error) = await treasure.RevealAsync(order, req, MailEndpoints.SiteUrl(site, http));
            return error != null ? Error(error) : Results.Ok(view);
        }).RequireRateLimiting("payment-check");

        // the gift game opens through the same flow as a bought one (a host claim, then the lobby)
        api.MapPost("/orders/{id:guid}/treasure/game", async (Guid id, HttpRequest http, PurchaseService purchases, TreasureService treasure) =>
        {
            if (await purchases.FindOrderAsync(id, http.Headers[PurchaseEndpoints.OrderKeyHeader]) == null) return Results.NotFound(NoOrder);
            if (await treasure.GiftEntitlementAsync(id) is not { } gift)
                return Results.NotFound(new ApiError("no-gift", "לרכישה הזאת אין משחק מתנה פתוח."));
            var (game, error) = await purchases.OpenGameAsync(id, gift);
            return error != null ? Error(error) : Results.Ok(new { code = game!.Code, hostClaim = game.HostClaim, existing = game.Existing });
        }).RequireRateLimiting("create");
    }

    /// <summary>The "תיבת האוצר" tab. Mapped on the admin group, so every call needs the admin role (and the CSRF header to change).</summary>
    public static void MapAdminTreasure(RouteGroupBuilder secured)
    {
        var t = secured.MapGroup("/treasure");
        t.MapGet("/config", async (TreasureAdmin s) => Results.Ok(await s.ConfigAsync()));

        t.MapPut("/config", async (TreasureConfigInput input, HttpContext ctx, TreasureService treasure, AdminService audit) =>
        {
            var admin = AdminAuth.Name(ctx.User);
            var (config, error) = await treasure.SaveConfigAsync(input, admin);
            if (error != null) return Results.BadRequest(new ApiError("invalid", error));
            await audit.AuditAsync(admin, "treasure-config-saved", "treasure-config", config!.Id.ToString(),
                new { config.Enabled, config.FallbackKey, prizes = TreasureService.Prizes(config) });
            return Results.Ok(new { id = config.Id });
        });

        t.MapGet("/gifts", async (TreasureAdmin s) => Results.Ok(await s.GiftProductsAsync()));

        t.MapPut("/gifts/{productId}", async (string productId, TreasureGiftToggle req, HttpContext ctx, TreasureAdmin s, AdminService audit) =>
        {
            var admin = AdminAuth.Name(ctx.User);
            if (await s.SetGiftAsync(productId, req.Selected, admin) is { } error) return Results.BadRequest(new ApiError("invalid", error));
            await audit.AuditAsync(admin, req.Selected ? "treasure-gift-added" : "treasure-gift-removed", "product", productId);
            return Results.Ok();
        });

        t.MapGet("/stats", async (HttpRequest r, TreasureAdmin s) => Results.Ok(await s.StatsAsync(AdminFilter.Parse(r))));
        t.MapGet("/wins", async (HttpRequest r, TreasureAdmin s) => Results.Ok(await s.WinsAsync(AdminFilter.Parse(r))));

        t.MapGet("/wins.csv", async (HttpRequest r, HttpContext ctx, TreasureAdmin s, AdminService audit) =>
        {
            await audit.AuditAsync(AdminAuth.Name(ctx.User), "treasure-wins-exported", null, null, new { query = r.QueryString.Value });
            return Results.File(System.Text.Encoding.UTF8.GetPreamble().Concat(System.Text.Encoding.UTF8.GetBytes(await s.WinsCsvAsync(AdminFilter.Parse(r)))).ToArray(),
                "text/csv; charset=utf-8", $"treasure-wins-{DateTime.UtcNow:yyyyMMdd}.csv");
        });
    }
}
