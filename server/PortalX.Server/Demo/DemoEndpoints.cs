using PortalX.Server.Referrals;

namespace PortalX.Server.Demo;

public sealed record DemoStartRequest(string? Device);
public sealed record DemoInspectRequest(string? Item);
public sealed record DemoCodeRequest(string? Code);
public sealed record DemoEventRequest(string? Type, string? ProductId, string? Device);
public sealed record DemoRefRequest(string? Ref);

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

        // the personal coupon of a finished taste: issued here once per session (only after the server recorded the right
        // code), and the same coupon on every later call (a refresh, a second tab)
        demo.MapPost("/coupon", async (HttpRequest http, DemoCouponService s) =>
        {
            var (coupon, reason) = await s.IssueAsync(http.Cookies[DemoService.Cookie], DateTime.UtcNow);
            NoStore(http);
            return Results.Ok(new { coupon, reason });
        }).RequireRateLimiting("demo");

        // the steps around the room that only the browser sees (an impression, a click, the offer, leaving); also sent with
        // navigator.sendBeacon while the page closes, so it always answers 204 and never fails the page
        demo.MapPost("/event", async (DemoEventRequest? req, HttpRequest http, DemoService s, ReferralService referrals) =>
        {
            var link = req?.Type is "demo_impression" or "demo_click" ? await referrals.ResolveVisitAsync(http.Cookies[ReferralService.VisitCookie]) : null;
            var known = await s.ReportAsync(http.Cookies[DemoService.Cookie], req?.Type, req?.ProductId, req?.Device, link, DateTime.UtcNow);
            return known ? Results.NoContent() : Results.Json(new ApiError("demo-event", "אירוע לא מוכר."), statusCode: 400);
        }).RequireRateLimiting("demo");

        // "/demo?ref=CODE": the same personal link as "/r/CODE", checked on the server and kept in the visit's HttpOnly
        // cookie; an unknown or disabled code changes nothing. The browser never chooses which link a purchase counts for.
        demo.MapPost("/ref", async (DemoRefRequest? req, HttpContext ctx, ReferralService referrals, ILoggerFactory logs) =>
        {
            try
            {
                var visit = await referrals.OpenVisitAsync(req?.Ref?.Trim(), ctx.Request.Cookies[ReferralService.VisitCookie]);
                if (visit != null) ctx.Response.Cookies.Append(ReferralService.VisitCookie, visit, ReferralService.VisitCookieOptions(ctx.Request));
            }
            catch (Exception ex)
            {
                logs.CreateLogger("Demo").LogWarning("Demo referral visit not recorded ({Type})", ex.GetType().Name);
            }
            NoStore(ctx.Request);
            return Results.NoContent();
        }).RequireRateLimiting("referral-visit");
    }

    private static void NoStore(HttpRequest http) => http.HttpContext.Response.Headers.CacheControl = "no-store";
}
