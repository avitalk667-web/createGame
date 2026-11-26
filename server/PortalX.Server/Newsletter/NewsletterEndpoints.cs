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
    }
}
