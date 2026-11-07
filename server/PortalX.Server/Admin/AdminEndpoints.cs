using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace PortalX.Server.Admin;

public sealed record AdminLoginRequest(string? Username, string? Password);

public sealed record FreeGameRequest(string? ProductId);

public static class AdminEndpoints
{
    private static readonly ApiError Denied = new("forbidden", "אין הרשאה.");

    public static void MapAdminEndpoints(this RouteGroupBuilder api)
    {
        var admin = api.MapGroup("/admin");

        admin.MapPost("/login", async (AdminLoginRequest req, HttpContext ctx, IOptions<AdminOptions> options, AdminLoginGuard guard, AdminService service, ILoggerFactory logs) =>
        {
            if (!options.Value.Configured)
                return Results.Json(new ApiError("admin-not-configured", "כניסת המנהל לא הוגדרה בשרת."), statusCode: 503);
            var key = ctx.Connection.RemoteIpAddress?.ToString() ?? "x";
            var now = DateTime.UtcNow;
            if (guard.IsLocked(key, now))
                return Results.Json(new ApiError("locked", "יותר מדי ניסיונות כניסה שגויים. נסו שוב בעוד 15 דקות."), statusCode: 429);
            var check = AdminAuth.Check(options.Value, req.Username, req.Password);
            if (check != AdminAuth.LoginCheck.Ok)
            {
                guard.Failed(key, now);
                // the cause goes to the server log only (visible to the owner); the visitor gets the same generic message
                logs.CreateLogger("AdminLogin").LogWarning("Admin login failed: {Cause}. Configured hash: {HashStatus}", check, AdminAuth.HashStatus(options.Value));
                await service.AuditAsync(req.Username?.Trim() is { Length: > 0 and <= 64 } u ? u : "?", "login-failed", null, null);
                return Results.Json(new ApiError("bad-login", "שם המשתמש או הסיסמה שגויים."), statusCode: 401);
            }
            guard.Succeeded(key);
            await AdminAuth.SignInAsync(ctx, options.Value.Username);
            await service.AuditAsync(options.Value.Username, "login", null, null);
            return Results.Ok(new { name = options.Value.Username });
        }).RequireRateLimiting("admin-login");

        // lets the site decide whether to show the admin button; reveals nothing but yes/no for the caller's own cookie
        admin.MapGet("/session", async (HttpContext ctx) =>
        {
            var auth = await ctx.AuthenticateAsync(AdminAuth.Scheme);
            var isAdmin = auth.Succeeded && auth.Principal.IsInRole(AdminAuth.Role);
            return Results.Ok(new { admin = isAdmin, name = isAdmin ? AdminAuth.Name(auth.Principal!) : null });
        });

        admin.MapPost("/logout", async (HttpContext ctx) =>
        {
            await ctx.SignOutAsync(AdminAuth.Scheme);
            return Results.Ok();
        });

        // everything below: a verified admin session on every request (hiding a button is not protection)
        var secured = admin.MapGroup("").RequireAuthorization(AdminAuth.Policy).AddEndpointFilter(async (ctx, next) =>
        {
            var http = ctx.HttpContext;
            if (!HttpMethods.IsGet(http.Request.Method) && http.Request.Headers[AdminAuth.CsrfHeader] != "1")
                return Results.Json(Denied, statusCode: 403);
            return await next(ctx);
        });

        secured.MapGet("/me", (HttpContext ctx) => Results.Ok(new { name = AdminAuth.Name(ctx.User) }));

        // How the server sees this request's address behind Render's proxies — to confirm, from a phone network and
        // from a Wi-Fi, that each one is told apart correctly. Only the admin's own request is shown.
        secured.MapGet("/diagnostics/client", (HttpContext ctx) => Results.Ok(new
        {
            clientIp = ctx.Connection.RemoteIpAddress?.ToString(),
            limitKey = PortalX.Server.Security.ClientIp.Key(ctx),
            directPeer = ctx.Items[PortalX.Server.Security.ClientIp.OriginalPeerItem] as string,
            forwardedFor = ctx.Request.Headers["X-Forwarded-For"].ToString(),
            cfConnectingIp = ctx.Request.Headers["CF-Connecting-IP"].ToString(),
            trueClientIp = ctx.Request.Headers["True-Client-IP"].ToString(),
            realIp = ctx.Request.Headers["X-Real-IP"].ToString(),
            browserId = PortalX.Server.Security.BrowserIdentity.Of(ctx) != null ? "valid" : "none",
        }));

        secured.MapGet("/dashboard", async (HttpRequest r, AdminService s) => Results.Ok(await s.DashboardAsync(AdminFilter.Parse(r))));

        // the statistics tab: sales, activity, games and personal links in a range of Israel days
        secured.MapGet("/statistics", async (HttpRequest r, StatisticsService s) => Results.Ok(await s.GetAsync(StatisticsFilter.Parse(r, DateTime.UtcNow))));

        secured.MapGet("/orders", async (HttpRequest r, AdminService s) => Results.Ok(await s.OrderRowsAsync(AdminFilter.Parse(r))));

        secured.MapGet("/orders.csv", async (HttpRequest r, HttpContext ctx, AdminService s) =>
        {
            var bytes = await s.OrdersCsvAsync(AdminFilter.Parse(r));
            await s.AuditAsync(AdminAuth.Name(ctx.User), "sales-exported", null, null, new { query = r.QueryString.Value });
            return Results.File(bytes, "text/csv; charset=utf-8", $"portalx-sales-{DateTime.UtcNow:yyyy-MM-dd}.csv");
        });

        // the keys and the connection, from this server; only reads
        secured.MapPost("/sumit/check", async (HttpContext ctx, AdminService s, IConfiguration config, PortalX.Server.Mail.SiteOptions site, IHostEnvironment env,
            Payments.SumitHttp http, Payments.PaymentGateway gateway, ILoggerFactory logs) =>
        {
            await s.AuditAsync(AdminAuth.Name(ctx.User), "sumit-connection-checked", null, null);
            return Results.Ok(await Payments.SumitConnectionCheck.RunAsync(config, site, env, http, gateway, logs.CreateLogger("Payments")));
        });

        // one real purchase by the admin, to prove the whole path while the sale stays paused. The charge happens only on SUMIT's page.
        secured.MapPost("/products/{id}/trial-order", async (string id, HttpContext ctx, AdminService s, Payments.PurchaseService purchases, Payments.PaymentGateway gateway) =>
        {
            if (gateway.Provider is not Payments.SumitPaymentProvider)
                return Results.Json(new ApiError("provider-off", "ספק התשלום SUMIT כבוי, ולכן אי אפשר לפתוח רכישת ניסיון."), statusCode: 409);
            if (await s.RecentTrialOrderAsync())
                return Results.Json(new ApiError("trial-exists", "כבר נפתחה רכישת ניסיון בשעה האחרונה. אפשר לנסות שוב אחרי שהקישור שלה יפוג."), statusCode: 409);
            var (created, error) = await purchases.CreateOrderAsync(id, null, adminTrial: true);
            if (error != null) return Results.Json(new ApiError(error.Code, error.Message), statusCode: error.Status);
            await s.AuditAsync(AdminAuth.Name(ctx.User), AdminService.TrialOrderAction, "order", created!.Order.Id.ToString(), new { product = id, amount = created.Order.PriceSnapshot });
            return Results.Ok(new { orderId = created.Order.Id, accessKey = created.AccessKey, checkoutUrl = created.CheckoutUrl, price = created.Order.PriceSnapshot, productName = created.Order.ProductName });
        });

        // asks SUMIT about one order, for example when a buyer says they paid
        secured.MapPost("/orders/{id:guid}/check-payment", async (Guid id, HttpContext ctx, AdminService s, Payments.SumitReconciler sumit) =>
        {
            var result = await sumit.LookupAsync(id, "admin", spaced: false);
            await s.AuditAsync(AdminAuth.Name(ctx.User), "order-payment-checked", "order", id.ToString(), new { result });
            return Results.Ok(new { result });
        });

        // records a refund already made at the provider: the game can no longer be opened, the history stays
        secured.MapPost("/orders/{id:guid}/mark-refunded", async (Guid id, HttpContext ctx, AdminService s, Payments.PurchaseService purchases,
            Microsoft.AspNetCore.SignalR.IHubContext<PortalX.Server.Hubs.GameHub> hub) =>
        {
            var (ok, result) = await purchases.MarkRefundedAsync(id);
            if (!ok) return Results.Json(new ApiError(result, "אפשר לסמן החזר רק להזמנה ששולמה."), statusCode: 409);
            await s.AuditAsync(AdminAuth.Name(ctx.User), "order-marked-refunded", "order", id.ToString());
            // whoever is in the game right now is told why it stopped answering
            if (await purchases.OpenRoomOfOrderAsync(id) is { } roomId)
                await hub.Clients.Group("room:" + roomId).SendAsync("notice", new PortalX.Server.Game.GameNotice("refunded", PortalX.Server.Game.RoomService.RefundedMessage));
            return Results.Ok(new { result });
        });

        secured.MapGet("/games", async (HttpRequest r, AdminService s) => Results.Ok(await s.GamesAsync(AdminFilter.Parse(r))));

        secured.MapGet("/games/{code}", async (string code, AdminService s) =>
            await s.GameDetailsAsync(code) is { } g ? Results.Ok(g) : Results.NotFound(new ApiError("no-game", "המשחק לא נמצא.")));

        secured.MapGet("/products", async (AdminService s) => Results.Ok(await s.ProductsAsync()));

        secured.MapPut("/products/{id}", async (string id, ProductUpdate u, HttpContext ctx, AdminService s) =>
        {
            var (product, error) = await s.UpdateProductAsync(id, u, AdminAuth.Name(ctx.User));
            return error != null ? Results.BadRequest(new ApiError("invalid", error)) : Results.Ok(product);
        });

        // a room of any game without payment: no order, no provider call, no document. The admin's session and header are checked above.
        secured.MapPost("/free-game", async (FreeGameRequest req, HttpContext ctx, AdminService s) =>
        {
            var (game, productName, error) = await s.OpenFreeGameAsync(req.ProductId ?? "", AdminAuth.Name(ctx.User));
            return error != null
                ? Results.BadRequest(new ApiError("invalid", error))
                : Results.Ok(new { code = game!.Code, hostClaim = game.HostClaim, productId = req.ProductId, productName });
        });

        // a fresh host claim for such a room while it waits in the lobby; never for a purchased game
        secured.MapPost("/games/{code}/host-claim", async (string code, AdminService s) =>
        {
            var (game, error) = await s.ReclaimFreeGameAsync(code);
            return error != null ? Results.NotFound(new ApiError("no-game", error)) : Results.Ok(new { code = game!.Code, hostClaim = game.HostClaim });
        });

        secured.MapGet("/audit", async (AdminService s) => Results.Ok(await s.AuditListAsync()));

        secured.MapAdminContentEndpoints();
        PortalX.Server.Mail.MailEndpoints.MapAdminMailing(secured);
        PortalX.Server.Referrals.ReferralEndpoints.MapAdminReferrals(secured);
        PortalX.Server.Mail.GmailAdminEndpoints.MapGmailAdmin(secured);
        // Google's return: outside the secured group, verified by state + binding + PKCE
        PortalX.Server.Mail.GmailAdminEndpoints.MapGmailCallback(admin);
    }
}
