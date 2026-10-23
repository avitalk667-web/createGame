using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Payments;

public sealed record CreateOrderRequest(string? ProductId, string? Email, string? CouponCode = null);
public sealed record CouponCheckRequest(string? ProductId, string? Code);
public sealed record SandboxOutcomeRequest(string? Outcome);

public static class PurchaseEndpoints
{
    /// <summary>Header carrying the buyer's secret order key (never a URL parameter, so it stays out of logs).</summary>
    public const string OrderKeyHeader = "X-Order-Key";

    private static IResult Error(ServiceError e) => Results.Json(new ApiError(e.Code, e.Message), statusCode: e.Status);

    private static readonly ApiError NoOrder = new("no-order", "ההזמנה לא נמצאה. בדקו שהקישור שמור אצלכם במלואו.");

    public static void MapPurchaseEndpoints(this RouteGroupBuilder api, PaymentGateway gateway)
    {
        api.MapPost("/orders", async (CreateOrderRequest req, PurchaseService purchases) =>
        {
            var (created, error) = await purchases.CreateOrderAsync(req.ProductId, req.Email, req.CouponCode);
            if (error != null) return Error(error);
            return Results.Ok(new
            {
                orderId = created!.Order.Id,
                number = created.Order.Number,
                accessKey = created.AccessKey,
                checkoutUrl = created.CheckoutUrl,
                isTest = created.Order.IsTest,
                originalPrice = created.Order.OriginalPrice,
                discount = created.Order.DiscountAmount,
                price = created.Order.PriceSnapshot,
                couponCode = created.Order.CouponCode,
            });
        }).RequireRateLimiting("create");

        // "Apply coupon" before paying: shows the price the server will charge (spec 4.4–4.7). Nothing is reserved yet.
        api.MapPost("/coupons/check", async (CouponCheckRequest req, PortalX.Server.Data.PortalDbContext db, CouponService coupons) =>
        {
            var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == (req.ProductId ?? "") && p.Status == ProductStatus.Published);
            if (product == null) return Results.NotFound(new ApiError("no-product", "המשחק לא נמצא."));
            var (quote, error) = await coupons.QuoteAsync(req.Code, product, DateTime.UtcNow);
            if (error != null) return Error(error);
            return Results.Ok(new
            {
                code = quote!.Code, kind = quote.Kind.ToString().ToLowerInvariant(), value = quote.Value,
                originalPrice = quote.OriginalPrice, discount = quote.Discount, finalPrice = quote.FinalPrice, currency = product.Currency,
            });
        }).RequireRateLimiting("coupon");

        api.MapGet("/orders/{id:guid}", async (Guid id, HttpRequest http, PurchaseService purchases) =>
            await purchases.FindOrderAsync(id, http.Headers[OrderKeyHeader]) is { } order
                ? Results.Ok(await purchases.OrderViewAsync(order))
                : Results.NotFound(NoOrder)).RequireRateLimiting("join");

        api.MapPost("/orders/{id:guid}/game", async (Guid id, HttpRequest http, PurchaseService purchases) =>
        {
            if (await purchases.FindOrderAsync(id, http.Headers[OrderKeyHeader]) == null) return Results.NotFound(NoOrder);
            var (game, error) = await purchases.OpenGameAsync(id);
            return error != null ? Error(error) : Results.Ok(new { code = game!.Code, hostClaim = game.HostClaim, existing = game.Existing });
        }).RequireRateLimiting("create");

        // Server-to-server payment notifications. Only a verified signature can change an order.
        api.MapPost("/payments/webhook/{provider}", async (string provider, HttpRequest http, PurchaseService purchases) =>
        {
            using var reader = new StreamReader(http.Body);
            var body = await reader.ReadToEndAsync();
            if (body.Length > 64 * 1024) return Results.BadRequest();
            var outcome = await purchases.HandleWebhookAsync(provider, body, http.Headers);
            return outcome.Status switch
            {
                WebhookStatus.Ok => Results.Ok(new { result = outcome.Result }),
                WebhookStatus.Unauthorized => Results.Unauthorized(),
                WebhookStatus.NotFound => Results.NotFound(),
                _ => Results.BadRequest(),
            };
        });

        if (gateway.Provider is SandboxPaymentProvider sandbox) MapSandbox(api, sandbox);
    }

    /// <summary>The test provider's "hosted payment page" API. Registered only when the sandbox is active (never in production).</summary>
    private static void MapSandbox(RouteGroupBuilder api, SandboxPaymentProvider sandbox)
    {
        static Task<Order?> BySession(PortalDbContext db, string session) =>
            db.Orders.AsNoTracking().FirstOrDefaultAsync(o => o.Provider == "sandbox" && o.ProviderSessionId == session);

        api.MapGet("/sandbox/checkout/{session}", async (string session, PortalDbContext db) =>
            await BySession(db, session) is { } o
                ? Results.Ok(new { number = o.Number, productName = o.ProductName, amount = o.PriceSnapshot, currency = o.Currency, status = o.Status.ToString().ToLowerInvariant(), orderId = o.Id })
                : Results.NotFound(new ApiError("no-session", "דף התשלום לא נמצא.")));

        api.MapPost("/sandbox/checkout/{session}", async (string session, SandboxOutcomeRequest req, PortalDbContext db, PurchaseService purchases) =>
        {
            var order = await BySession(db, session);
            if (order == null) return Results.NotFound(new ApiError("no-session", "דף התשלום לא נמצא."));
            PaymentEventType? type = req.Outcome switch
            {
                "approve" => PaymentEventType.Succeeded,
                "decline" => PaymentEventType.Failed,
                "cancel" => PaymentEventType.Cancelled,
                _ => null,
            };
            if (type == null) return Results.BadRequest(new ApiError("bad-outcome", "בחירה לא מוכרת."));
            var tx = type == PaymentEventType.Succeeded ? "sbx_tx_" + Guid.NewGuid().ToString("N")[..16] : null;
            var body = SandboxPaymentProvider.BuildBody(order, type.Value, tx);
            var headers = new HeaderDictionary { [SandboxPaymentProvider.SignatureHeader] = sandbox.Sign(body) };
            // delivered through the same verification path as a provider's server-to-server call
            var outcome = await purchases.HandleWebhookAsync(sandbox.Name, body, headers);
            return Results.Ok(new { result = outcome.Result, returnUrl = $"/checkout/{order.Id}" });
        });
    }
}
