using PortalX.Server.Admin;
using PortalX.Server.Mail;

namespace PortalX.Server.Newsletter;

/// <summary>Admin only (inside the secured admin group): the "סודות הפורטל" mailings.</summary>
public static class NewsletterEndpoints
{
    public static void MapAdminNewsletters(this RouteGroupBuilder secured)
    {
        var n = secured.MapGroup("/newsletters");

        n.MapGet("", async (NewsletterService s) => Results.Ok(await s.ListAsync()));

        n.MapPost("", async (NewsletterCreateRequest req, HttpContext ctx, NewsletterService s, AdminService audit) =>
        {
            var issue = await s.CreateAsync(req);
            if (issue == null) return Results.NotFound(new ApiError("not-found", "הדיוור המקורי לא נמצא."));
            await audit.AuditAsync(AdminAuth.Name(ctx.User), "newsletter-created", "newsletter", issue.Id.ToString(), new { req.From });
            return Results.Ok(new { id = issue.Id });
        });

        n.MapGet("/{id:guid}", async (Guid id, NewsletterService s) =>
            await s.DetailAsync(id) is { } d ? Results.Ok(d) : Results.NotFound(new ApiError("not-found", "הדיוור לא נמצא.")));

        n.MapPut("/{id:guid}", async (Guid id, NewsletterSaveRequest req, HttpContext ctx, NewsletterService s, AdminService audit) =>
        {
            var error = await s.SaveAsync(id, req);
            if (error == "not-found") return Results.NotFound(new ApiError("not-found", "הדיוור לא נמצא."));
            if (error != null) return Results.BadRequest(new ApiError("invalid", error));
            await audit.AuditAsync(AdminAuth.Name(ctx.User), "newsletter-saved", "newsletter", id.ToString());
            return Results.Ok(new { ok = true });
        });

        n.MapDelete("/{id:guid}", async (Guid id, HttpContext ctx, NewsletterService s, AdminService audit) =>
        {
            var error = await s.DeleteAsync(id);
            if (error == "not-found") return Results.NotFound(new ApiError("not-found", "הדיוור לא נמצא."));
            if (error != null) return Results.Json(new ApiError("locked", error), statusCode: 409);
            await audit.AuditAsync(AdminAuth.Name(ctx.User), "newsletter-deleted", "newsletter", id.ToString());
            return Results.Ok(new { ok = true });
        });

        // the email as one recipient would get it (or a sample one), from the content being edited — nothing is saved or sent
        n.MapPost("/preview", async (NewsletterPreviewRequest req, HttpRequest r, NewsletterService s, SiteOptions site) =>
            req.Content == null ? Results.BadRequest(new ApiError("invalid", "חסר תוכן."))
                : Results.Ok(await s.PreviewAsync(req.Content, req.Email, MailEndpoints.SiteUrl(site, r))));

        n.MapPost("/{id:guid}/test", async (Guid id, NewsletterTestRequest req, HttpRequest r, HttpContext ctx, NewsletterService s, SiteOptions site, AdminService audit) =>
        {
            var (reply, status) = await s.TestAsync(id, req, MailEndpoints.SiteUrl(site, r));
            if (status == 200) await audit.AuditAsync(AdminAuth.Name(ctx.User), "newsletter-test-sent", "newsletter", id.ToString(), new { count = req.Emails?.Count ?? 0 });
            return Results.Json(reply, statusCode: status);
        });

        n.MapPost("/{id:guid}/send", async (Guid id, NewsletterSendRequest req, HttpRequest r, HttpContext ctx, NewsletterService s, SiteOptions site, AdminService audit) =>
        {
            var (reply, status) = await s.StartAsync(id, req, MailEndpoints.SiteUrl(site, r));
            if (status == 200) await audit.AuditAsync(AdminAuth.Name(ctx.User), "newsletter-send-started", "newsletter", id.ToString(), new { recipients = req.Confirm });
            return Results.Json(reply, statusCode: status);
        });

        n.MapPost("/{id:guid}/stop", async (Guid id, HttpContext ctx, NewsletterService s, AdminService audit) =>
        {
            await s.StopAsync(id);
            await audit.AuditAsync(AdminAuth.Name(ctx.User), "newsletter-send-stopped", "newsletter", id.ToString());
            return Results.Ok(new { ok = true });
        });

        n.MapGet("/{id:guid}/deliveries", async (Guid id, NewsletterService s) => Results.Ok(await s.DeliveriesAsync(id)));

        // ---- the numbers: one mailing, its recipients, and all mailings side by side
        n.MapGet("/compare", async (NewsletterStats s) => Results.Ok(await s.CompareAsync()));

        n.MapGet("/{id:guid}/stats", async (Guid id, NewsletterStats s) =>
            await s.IssueAsync(id) is { } st ? Results.Ok(st) : Results.NotFound(new ApiError("not-found", "הדיוור לא נמצא.")));

        n.MapGet("/{id:guid}/stats/recipients", async (Guid id, string? filter, NewsletterStats s) =>
            await s.RecipientsAsync(id, filter) is { } st ? Results.Ok(st) : Results.NotFound(new ApiError("not-found", "הדיוור לא נמצא.")));
    }

    /// <summary>
    /// Public: every link of a mailing passes here. The address names one email and one of its links — never a
    /// destination — and the server sends the browser to that link's stored destination (the home page for anything
    /// unknown). HEAD is answered too, so a scanner that only peeks is recorded as one.
    /// </summary>
    public static void MapNewsletterClick(this WebApplication app)
    {
        app.MapMethods(NewsletterTracking.ClickPath + "{token}", ["GET", "HEAD"], async (string token, HttpContext ctx, NewsletterTracking tracking) =>
        {
            var h = ctx.Request.Headers;
            var info = new NewsletterClickInfo(ctx.Request.Method, h.UserAgent.ToString(), h["Sec-Purpose"].FirstOrDefault() ?? h["Purpose"].FirstOrDefault());
            var result = await tracking.ClickAsync(token, info, DateTime.UtcNow);
            if (result.AttributionToken != null)
                ctx.Response.Cookies.Append(NewsletterTracking.AttributionCookie, result.AttributionToken, NewsletterTracking.AttributionCookieOptions(ctx.Request));
            ctx.Response.Headers.CacheControl = "no-store";
            ctx.Response.Headers["Referrer-Policy"] = "no-referrer";
            ctx.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
            return Results.Redirect(result.Target);
        }).RequireRateLimiting("newsletter-click");
    }
}
