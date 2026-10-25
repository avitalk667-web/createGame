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

        secured.MapGet("/dashboard", async (HttpRequest r, AdminService s) => Results.Ok(await s.DashboardAsync(AdminFilter.Parse(r))));

        secured.MapGet("/orders", async (HttpRequest r, AdminService s) => Results.Ok(await s.OrderRowsAsync(AdminFilter.Parse(r))));

        secured.MapGet("/orders.csv", async (HttpRequest r, HttpContext ctx, AdminService s) =>
        {
            var bytes = await s.OrdersCsvAsync(AdminFilter.Parse(r));
            await s.AuditAsync(AdminAuth.Name(ctx.User), "sales-exported", null, null, new { query = r.QueryString.Value });
            return Results.File(bytes, "text/csv; charset=utf-8", $"portalx-sales-{DateTime.UtcNow:yyyy-MM-dd}.csv");
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

        secured.MapPost("/free-game", async (FreeGameRequest req, HttpContext ctx, AdminService s) =>
        {
            var (game, error) = await s.OpenFreeGameAsync(req.ProductId ?? "", AdminAuth.Name(ctx.User));
            return error != null ? Results.BadRequest(new ApiError("invalid", error)) : Results.Ok(new { code = game!.Code, hostClaim = game.HostClaim });
        });

        secured.MapPost("/games/{code}/host-claim", async (string code, AdminService s) =>
        {
            var (game, error) = await s.ReclaimFreeGameAsync(code);
            return error != null ? Results.NotFound(new ApiError("no-game", error)) : Results.Ok(new { code = game!.Code, hostClaim = game.HostClaim });
        });

        secured.MapGet("/audit", async (AdminService s) => Results.Ok(await s.AuditListAsync()));

        secured.MapAdminContentEndpoints();
        PortalX.Server.Mail.MailEndpoints.MapAdminMailing(secured);
        PortalX.Server.Mail.GmailAdminEndpoints.MapGmailAdmin(secured);
        // Google's return: outside the secured group, verified by state + binding + PKCE
        PortalX.Server.Mail.GmailAdminEndpoints.MapGmailCallback(admin);
    }
}
