using PortalX.Server.Admin;
using PortalX.Server.Game;
using PortalX.Server.Mail;
using PortalX.Server.Payments;
using PortalX.Server.Security;

namespace PortalX.Server.Challenge;

public sealed record ChallengeActiveRequest(bool Active);
public sealed record ChallengePauseRequest(bool Paused);

public static class ChallengeEndpoints
{
    private static IResult Error(ServiceError e) => Results.Json(new ApiError(e.Code, e.Message), statusCode: e.Status);

    private static async Task<string?> SeatCookieAsync(string code, HttpRequest http, RoomService rooms)
    {
        var room = await rooms.FindByCodeAsync(code);
        return room == null ? null : http.Cookies[RoomService.SeatCookie(room.Id)];
    }

    /// <summary>The player's side: what the campaign offers, their eligibility, their coupon, and a resend.</summary>
    public static void MapChallengeEndpoints(this RouteGroupBuilder api)
    {
        // GetActiveCouponCampaign — the popup and the progress read it (never any counts)
        api.MapGet("/challenge", async (ChallengeService s) => Results.Ok(await s.PublicAsync()));

        // CheckPlayerEligibility + GetPlayerCoupon (also after a refresh: the seat token proves who the player is)
        api.MapPost("/challenge/rooms/{code}/status", async (string code, ChallengeTokenRequest body, HttpRequest http, RoomService rooms, ChallengeService s) =>
        {
            var (status, error) = await s.StatusAsync(code, body.Token, await SeatCookieAsync(code, http, rooms), BrowserIdentity.Of(http.HttpContext));
            return error != null ? Error(error) : Results.Ok(status);
        }).RequireRateLimiting("challenge-status");

        // IssueCoupon
        api.MapPost("/challenge/rooms/{code}/coupon", async (string code, ChallengeIssueRequest body, HttpRequest http, RoomService rooms, ChallengeService s, SiteOptions site) =>
        {
            var (status, error) = await s.IssueAsync(code, body, await SeatCookieAsync(code, http, rooms), BrowserIdentity.Of(http.HttpContext), MailEndpoints.SiteUrl(site, http));
            return error != null ? Error(error) : Results.Ok(status);
        }).RequireRateLimiting("challenge-issue");

        // ResendCouponEmail — the same coupon, never a new one
        api.MapPost("/challenge/rooms/{code}/resend", async (string code, ChallengeTokenRequest body, HttpRequest http, RoomService rooms, ChallengeService s, SiteOptions site) =>
        {
            var (status, error) = await s.ResendAsync(code, body.Token, await SeatCookieAsync(code, http, rooms), BrowserIdentity.Of(http.HttpContext), MailEndpoints.SiteUrl(site, http));
            return error != null ? Error(error) : Results.Ok(status);
        }).RequireRateLimiting("challenge-issue");
    }

    /// <summary>The admin's side (inside the secured admin group). Every change is written to the audit log.</summary>
    public static void MapAdminChallenge(this RouteGroupBuilder secured)
    {
        secured.MapGet("/challenge", async (ChallengeService s) => Results.Ok(await s.AdminViewAsync()));

        secured.MapPut("/challenge", async (CampaignInput u, HttpContext ctx, ChallengeService s, AdminService a) =>
        {
            var (error, before, after) = await s.UpdateAsync(u);
            if (error != null) return Results.BadRequest(new ApiError("invalid", error));
            await a.AuditAsync(AdminAuth.Name(ctx.User), "challenge-updated", "challenge", null, new { before, after });
            return Results.Ok(await s.AdminViewAsync());
        });

        secured.MapPost("/challenge/active", async (ChallengeActiveRequest req, HttpContext ctx, ChallengeService s, AdminService a) =>
        {
            if (await s.SetActiveAsync(req.Active) is { } error) return Results.BadRequest(new ApiError("invalid", error));
            await a.AuditAsync(AdminAuth.Name(ctx.User), req.Active ? "challenge-activated" : "challenge-deactivated", "challenge", null);
            return Results.Ok(await s.AdminViewAsync());
        });

        secured.MapPost("/challenge/issuing", async (ChallengePauseRequest req, HttpContext ctx, ChallengeService s, AdminService a) =>
        {
            await s.SetIssuingPausedAsync(req.Paused);
            await a.AuditAsync(AdminAuth.Name(ctx.User), req.Paused ? "challenge-issuing-paused" : "challenge-issuing-resumed", "challenge", null);
            return Results.Ok(await s.AdminViewAsync());
        });

        secured.MapGet("/challenge/coupons", async (HttpRequest r, ChallengeService s) => Results.Ok(await s.CouponsAsync(ChallengeCouponFilter.Parse(r))));

        secured.MapGet("/challenge/coupons.csv", async (HttpRequest r, HttpContext ctx, ChallengeService s, AdminService a) =>
        {
            var f = ChallengeCouponFilter.Parse(r);
            var bytes = await s.CsvAsync(f);
            // the audit keeps the filters, never the searched address
            await a.AuditAsync(AdminAuth.Name(ctx.User), "challenge-coupons-exported", "challenge", null, new { f.Status, f.From, f.To, searched = f.Search != null });
            return Results.File(bytes, "text/csv; charset=utf-8", $"portalx-challenge-coupons-{DateTime.UtcNow:yyyy-MM-dd}.csv");
        });

        secured.MapGet("/challenge/coupons/{id:guid}", async (Guid id, ChallengeService s) =>
            await s.CouponDetailAsync(id) is { } d ? Results.Ok(d) : Results.NotFound(new ApiError("no-coupon", "הקופון לא נמצא.")));

        secured.MapPost("/challenge/coupons/{id:guid}/cancel", async (Guid id, HttpContext ctx, ChallengeService s, AdminService a) =>
        {
            var admin = AdminAuth.Name(ctx.User);
            if (await s.CancelAsync(id, admin) is { } error) return Results.BadRequest(new ApiError("invalid", error));
            await a.AuditAsync(admin, "challenge-coupon-cancelled", "coupon", id.ToString());
            return Results.Ok(await s.CouponDetailAsync(id));
        });

        secured.MapPost("/challenge/coupons/{id:guid}/resend", async (Guid id, HttpRequest r, HttpContext ctx, ChallengeService s, AdminService a, SiteOptions site) =>
        {
            var admin = AdminAuth.Name(ctx.User);
            var (error, status) = await s.AdminResendAsync(id, admin, MailEndpoints.SiteUrl(site, r));
            if (error != null) return Results.BadRequest(new ApiError("invalid", error));
            await a.AuditAsync(admin, "challenge-coupon-resent", "coupon", id.ToString(), new { status });
            return Results.Ok(await s.CouponDetailAsync(id));
        }).RequireRateLimiting("email-admin");
    }
}
