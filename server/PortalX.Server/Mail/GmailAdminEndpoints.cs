using PortalX.Server.Admin;

namespace PortalX.Server.Mail;

/// <summary>
/// "Email setup" for the admin: status, connecting the Gmail mailbox (OAuth) and an explicit test email.
/// Nothing here returns a token, a code or a secret.
/// </summary>
public static class GmailAdminEndpoints
{
    /// <summary>Inside the secured admin group (admin session + admin header on every call).</summary>
    public static void MapGmailAdmin(this RouteGroupBuilder secured)
    {
        secured.MapGet("/email/status", async (GmailAccount gmail, SiteOptions site, ResultsEmailPolicy policy) =>
        {
            var v = await gmail.ViewAsync();
            return Results.Ok(new
            {
                v.Configured, v.Missing, v.RedirectUri, v.Sender, v.Status, v.Connected, v.NeedsReconnect,
                v.LastError, v.LastErrorAt, v.ConnectedAt, v.LastSendAt, v.LastTestSentAt, v.SendScopeGranted,
                siteUrl = site.SiteUrl,
                communityGroup = site.CommunityGroupUrl != null,
                communityGroupRejected = site.CommunityGroupRejected,
                // the documented wording and behaviour of the end-of-game form
                resultsPolicy = new
                {
                    requireMarketingConsent = policy.RequireMarketingConsent,
                    consentVersion = ResultsEmailService.ConsentVersion,
                    consentText = ResultsEmailService.ConsentText,
                    refusedMessage = ResultsEmailPolicy.ConsentRequiredMessage,
                },
            });
        });

        // starts the authorization: the answer is Google's consent page address (it carries no secret)
        secured.MapPost("/email/google/start", async (HttpContext ctx, GmailAccount gmail, GoogleMailOptions options, AdminService s) =>
        {
            if (!options.Configured)
                return Results.Json(new ApiError("not-configured", "חסרות הגדרות: " + string.Join(", ", options.Missing())), statusCode: 409);
            var admin = AdminAuth.Name(ctx.User);
            var (url, binding) = await gmail.StartAsync(admin);
            // ties Google's return to this browser; Lax so it comes back on Google's top-level redirect
            ctx.Response.Cookies.Append(GmailAccount.BindingCookie, binding, new CookieOptions
            {
                HttpOnly = true, Secure = ctx.Request.IsHttps, SameSite = SameSiteMode.Lax,
                Path = "/api/admin/email/google", MaxAge = GmailAccount.StateLifetime,
            });
            await s.AuditAsync(admin, "gmail-connect-started", null, null);
            return Results.Ok(new { url });
        }).RequireRateLimiting("email-admin");

        // an explicit test email to the site's own mailbox only
        secured.MapPost("/email/test", async (HttpContext ctx, GmailAccount gmail, GoogleMailOptions options, SiteOptions site, AdminService s) =>
        {
            if (!await gmail.IsAvailableAsync())
                return Results.Json(new ApiError("not-connected", "חשבון Gmail אינו מחובר. יש לחבר אותו קודם."), statusCode: 409);
            var siteUrl = MailEndpoints.SiteUrl(site, ctx.Request);
            var msg = new EmailMessage(options.SenderEmail, "בדיקת שליחה — PORTAL X",
                $"""<!doctype html><html lang="he" dir="rtl"><body style="margin:0;padding:24px;background:#0a1230;font-family:Arial,sans-serif;" dir="rtl"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="560" style="max-width:560px;background:#ffffff;border-radius:14px;border-top:4px solid #e0b95c;"><tr><td style="padding:24px;text-align:right;color:#1b2238;"><h1 style="margin:0 0 8px;font-size:22px;color:#0a1230;">מייל בדיקה מ־PORTAL X</h1><p style="margin:0 0 8px;font-size:16px;">שליחת המיילים דרך Gmail API פועלת. אפשר לשלוח לשחקנים את תוצאות המשחק.</p><p style="margin:0;font-size:13px;color:#5b6480;"><a href="{System.Net.WebUtility.HtmlEncode(siteUrl)}" style="color:#7a5a12;">PORTAL X</a></p></td></tr></table></td></tr></table></body></html>""",
                "מייל בדיקה מ־PORTAL X\nשליחת המיילים דרך Gmail API פועלת. אפשר לשלוח לשחקנים את תוצאות המשחק.\n" + siteUrl);
            var admin = AdminAuth.Name(ctx.User);
            try
            {
                var id = await gmail.SendAsync(msg);
                await gmail.MarkTestSentAsync();
                await s.AuditAsync(admin, "gmail-test-sent", null, null);
                return Results.Ok(new { ok = true, message = $"מייל הבדיקה נשלח אל {options.SenderEmail} ו־Gmail אישר את השליחה.", messageId = id });
            }
            catch (EmailSendException ex)
            {
                await s.AuditAsync(admin, "gmail-test-failed", null, null, new { ex.Code });
                var text = ex.Code switch
                {
                    "needs-reconnect" => "ההרשאה של Gmail אינה בתוקף. יש לחבר את החשבון מחדש.",
                    "quota" => "Gmail הגביל זמנית את השליחה (מכסה). נסו שוב מאוחר יותר.",
                    "uncertain" => "החיבור נקטע ולא ברור אם המייל נשלח. בדקו את תיבת הדואר לפני שתנסו שוב.",
                    _ => "השליחה נכשלה (" + ex.Code + "). נסו שוב בעוד רגע.",
                };
                return Results.Json(new { ok = false, code = ex.Code, message = text }, statusCode: 502);
            }
        }).RequireRateLimiting("email-admin");
    }

    /// <summary>
    /// Google's return (outside the secured group: the admin cookie is SameSite=Strict and is not sent on a redirect from
    /// Google). Trusted only through the single-use state, the browser binding cookie and PKCE. It answers with a redirect
    /// to the admin page carrying a short result code — never a code or token in any URL of ours.
    /// </summary>
    public static void MapGmailCallback(this RouteGroupBuilder admin)
    {
        admin.MapGet("/email/google/callback", async (HttpContext ctx, GmailAccount gmail, AdminService s) =>
        {
            var q = ctx.Request.Query;
            var binding = ctx.Request.Cookies[GmailAccount.BindingCookie];
            var result = await gmail.CompleteAsync(q["state"], q["code"], q["error"], binding);
            ctx.Response.Cookies.Delete(GmailAccount.BindingCookie, new CookieOptions { Path = "/api/admin/email/google" });
            await s.AuditAsync("google-callback", result == "connected" ? "gmail-connected" : "gmail-connect-failed", null, null, new { result });
            return Results.Redirect("/admin?tab=email-setup&gmail=" + Uri.EscapeDataString(result));
        }).RequireRateLimiting("email-admin");
    }
}
