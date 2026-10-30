using PortalX.Server.Admin;
using PortalX.Server.Mail;

namespace PortalX.Server.Referrals;

public sealed record ResendLinkRequest(string? Token);
public sealed record LinkStatusRequest(bool Active);

public static class ReferralEndpoints
{
    public static void MapReferralEndpoints(this RouteGroupBuilder api)
    {
        // the "friend brings a friend" campaign texts for the site's banner and popup (from Content/campaign.he.json)
        api.MapGet("/campaign", (CampaignContent campaign) => Results.Ok(campaign.Public()));

        api.MapGet("/referrals/terms", () => Results.Ok(new
        {
            consentText = ReferralService.ConsentText, consentVersion = ReferralService.ConsentVersion, termsText = ReferralService.TermsText,
        }));

        // the form: the link is shown at once (no email check first) and mailed through the site's Gmail sender
        api.MapPost("/referrals", async (CreateLinkRequest req, HttpRequest http, ReferralService service, SiteOptions site) =>
        {
            var (reply, status) = await service.CreateAsync(req, MailEndpoints.SiteUrl(site, http));
            return Results.Json(reply, statusCode: status);
        }).RequireRateLimiting("referral");

        // "send the link again": the link is identified by its own token, and goes only to its own address
        api.MapPost("/referrals/resend", async (ResendLinkRequest req, HttpRequest http, ReferralService service, SiteOptions site) =>
        {
            var (reply, status) = await service.ResendAsync(req.Token, MailEndpoints.SiteUrl(site, http));
            return Results.Json(reply, statusCode: status);
        }).RequireRateLimiting("referral-resend");
    }

    /// <summary>
    /// "/r/{token}": checks the link on the server, starts (or updates) this visit's referral session and goes to the home
    /// page, so the address bar no longer carries the token. An unknown or disabled link simply opens the site.
    /// </summary>
    public static void MapReferralRedirect(this WebApplication app)
    {
        app.MapGet("/r/{token}", async (string token, HttpContext ctx, ReferralService service, ILoggerFactory logs) =>
        {
            try
            {
                var visit = await service.OpenVisitAsync(token, ctx.Request.Cookies[ReferralService.VisitCookie]);
                if (visit != null) ctx.Response.Cookies.Append(ReferralService.VisitCookie, visit, ReferralService.VisitCookieOptions(ctx.Request));
            }
            catch (Exception ex)
            {
                // the link must always open the site, even when the database is not ready
                logs.CreateLogger("Referrals").LogWarning("Referral visit not recorded ({Type})", ex.GetType().Name);
            }
            ctx.Response.Headers.CacheControl = "no-store";
            return Results.Redirect("/");
        }).RequireRateLimiting("referral-visit");
    }

    /// <summary>Admin only (inside the secured admin group).</summary>
    public static void MapAdminReferrals(this RouteGroupBuilder secured)
    {
        secured.MapGet("/referrals", async (HttpRequest r, ReferralAdmin admin, SiteOptions site) =>
        {
            var (rows, summary) = await admin.ListAsync(ReferralFilter.Parse(r), MailEndpoints.SiteUrl(site, r));
            return Results.Ok(new { summary, rows });
        });

        secured.MapGet("/referrals.csv", async (HttpRequest r, HttpContext ctx, ReferralAdmin admin, AdminService s, SiteOptions site) =>
        {
            var f = ReferralFilter.Parse(r);
            var bytes = await admin.CsvAsync(f, MailEndpoints.SiteUrl(site, r));
            // the audit keeps the filters, never the searched text
            await s.AuditAsync(AdminAuth.Name(ctx.User), "referrals-exported", null, null,
                new { f.Status, f.Game, f.CreatedFrom, f.CreatedTo, f.PaidFrom, f.PaidTo, f.MinPurchases, f.MinNet, searched = f.Search != null });
            return Results.File(bytes, "text/csv; charset=utf-8", $"portalx-personal-links-{DateTime.UtcNow:yyyy-MM-dd}.csv");
        });

        secured.MapGet("/referrals/{id:guid}", async (Guid id, HttpRequest r, ReferralAdmin admin, SiteOptions site) =>
            await admin.DetailsAsync(id, MailEndpoints.SiteUrl(site, r)) is { } d ? Results.Ok(d) : Results.NotFound(new ApiError("no-link", "הקישור לא נמצא.")));

        secured.MapPost("/referrals/{id:guid}/status", async (Guid id, LinkStatusRequest req, HttpContext ctx, ReferralAdmin admin, AdminService s) =>
        {
            if (!await admin.SetStatusAsync(id, req.Active)) return Results.NotFound(new ApiError("no-link", "הקישור לא נמצא."));
            await s.AuditAsync(AdminAuth.Name(ctx.User), req.Active ? "referral-enabled" : "referral-disabled", "referral", id.ToString());
            return Results.Ok(new { ok = true });
        });
    }
}
