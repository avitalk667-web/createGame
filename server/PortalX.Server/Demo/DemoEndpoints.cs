using PortalX.Server.Referrals;

namespace PortalX.Server.Demo;

public sealed record DemoStartRequest(string? Device);
public sealed record DemoInspectRequest(string? Item);
public sealed record DemoCodeRequest(string? Code);

/// <summary>
/// "טעימה מהפורטל" (/demo): no sign-up. The browser's session lives in the HttpOnly px_demo cookie; every call acts only on
/// that browser's own session, and the answer of the riddle never leaves the server.
/// </summary>
public static class DemoEndpoints
{
    private static readonly ApiError NoSession = new("demo-session", "הטעימה לא נמצאה. היכנסו שוב לחדר כדי להתחיל.");

    public static void MapDemoEndpoints(this RouteGroupBuilder api)
    {
        var demo = api.MapGroup("/taste");

        // the browser's own session, if it has a live one (to continue after a refresh); never creates one
        demo.MapGet("/state", async (HttpRequest http, DemoService s) =>
        {
            var now = DateTime.UtcNow;
            var session = await s.FindAsync(http.Cookies[DemoService.Cookie], now);
            NoStore(http);
            return session == null ? Results.Ok(new { state = (DemoState?)null }) : Results.Ok(new { state = DemoService.StateOf(session, now) });
        }).RequireRateLimiting("demo");

        // entering the room: continues the browser's session or starts one (with the personal link of this visit, if any)
        demo.MapPost("/start", async (DemoStartRequest? req, HttpContext ctx, DemoService s, ReferralService referrals) =>
        {
            var now = DateTime.UtcNow;
            var link = await referrals.ResolveVisitAsync(ctx.Request.Cookies[ReferralService.VisitCookie]);
            var (session, token, _) = await s.StartAsync(ctx.Request.Cookies[DemoService.Cookie], req?.Device, link, now);
            ctx.Response.Cookies.Append(DemoService.Cookie, token, DemoService.CookieOptions(ctx.Request));
            NoStore(ctx.Request);
            return Results.Ok(new { state = DemoService.StateOf(session, now) });
        }).RequireRateLimiting("demo");

        demo.MapPost("/inspect", async (DemoInspectRequest req, HttpRequest http, DemoService s) =>
        {
            var state = await s.InspectAsync(http.Cookies[DemoService.Cookie], req.Item, DateTime.UtcNow);
            return state == null ? Results.Json(NoSession, statusCode: 404) : Results.Ok(new { state });
        }).RequireRateLimiting("demo");

        demo.MapPost("/hint", async (HttpRequest http, DemoService s) =>
        {
            var state = await s.HintAsync(http.Cookies[DemoService.Cookie], DateTime.UtcNow);
            return state == null ? Results.Json(NoSession, statusCode: 404) : Results.Ok(new { state });
        }).RequireRateLimiting("demo");

        demo.MapPost("/code", async (DemoCodeRequest req, HttpRequest http, DemoService s) =>
        {
            var reply = await s.TryCodeAsync(http.Cookies[DemoService.Cookie], req.Code, DateTime.UtcNow);
            return reply == null ? Results.Json(NoSession, statusCode: 404) : Results.Ok(reply);
        }).RequireRateLimiting("demo-code");
    }

    private static void NoStore(HttpRequest http) => http.HttpContext.Response.Headers.CacheControl = "no-store";
}
