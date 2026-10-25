using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;

namespace PortalX.Server.Mail;

public sealed record UnsubscribeRequest(string? Token);

public static class MailEndpoints
{
    /// <summary>The site's public address: from PORTALX_SITE_URL, or the address this request came to.</summary>
    public static string SiteUrl(SiteOptions site, HttpRequest r) => site.SiteUrl ?? $"{r.Scheme}://{r.Host}{r.PathBase}";

    public static void MapMailEndpoints(this RouteGroupBuilder api)
    {
        // public site details: the one contact address, and which end-of-game options this server can offer
        api.MapGet("/site", async (SiteOptions site, IEmailSender sender) => Results.Ok(new
        {
            contactEmail = site.ContactEmail,
            resultsEmail = await sender.IsAvailableAsync(),
            communityGroup = site.CommunityGroupUrl != null,
            consentText = ResultsEmailService.ConsentText,
            consentVersion = ResultsEmailService.ConsentVersion,
        }));

        // the end-of-game choices of one player (the seat token comes in the body or the game's seat cookie, never the URL)
        api.MapPost("/rooms/{code}/results-email", async (string code, EndOfGameChoices body, HttpRequest http, RoomService rooms,
            ResultsEmailService service, SiteOptions site) =>
        {
            var room = await rooms.FindByCodeAsync(code);
            var cookie = room == null ? null : http.Cookies[RoomService.SeatCookie(room.Id)];
            var (reply, status) = await service.HandleAsync(code, body, cookie, SiteUrl(site, http));
            return Results.Json(reply, statusCode: status);
        }).RequireRateLimiting("results-email");

        // unsubscribing needs no account: the signed token from the email's link is enough (and only for its own address)
        api.MapPost("/unsubscribe", async (UnsubscribeRequest body, UnsubscribeLinks links, PortalDbContext db, ILoggerFactory logs) =>
        {
            var consent = await links.FindAsync(body.Token);
            if (consent == null)
                return Results.Json(new ApiError("bad-link", "הקישור להסרה אינו תקין או שכבר אינו בתוקף. אפשר לפנות אלינו ונסיר את הכתובת ידנית."), statusCode: 400);
            if (consent.Status != ConsentStatus.Revoked)
            {
                consent.Status = ConsentStatus.Revoked;
                consent.RevokedAt = DateTime.UtcNow;
                consent.UpdatedAt = consent.RevokedAt.Value;
                await db.SaveChangesAsync();
                logs.CreateLogger("Mailing").LogInformation("Marketing consent {Consent} revoked by its owner", consent.Id);
            }
            return Results.Ok(new { ok = true, message = "ההסרה הושלמה. לא נשלח אליך עוד דיוור שיווקי מ־PORTAL X." });
        }).RequireRateLimiting("unsubscribe");
    }

    /// <summary>Admin only (inside the secured admin group): the list of addresses and their separate consents.</summary>
    public static void MapAdminMailing(this RouteGroupBuilder secured)
    {
        secured.MapGet("/mailing", async (HttpRequest r, MailingAdmin m) => Results.Ok(await m.ListAsync(MailingFilter.Parse(r))));

        secured.MapGet("/mailing.csv", async (HttpRequest r, HttpContext ctx, MailingAdmin m, AdminService s, SiteOptions site) =>
        {
            var f = MailingFilter.Parse(r);
            var bytes = await m.CsvAsync(f, SiteUrl(site, r));
            // the audit keeps the filters, never the searched address
            await s.AuditAsync(AdminAuth.Name(ctx.User), "mailing-exported", null, null, new { f.Consent, f.Status, f.Game, f.From, f.To, searched = f.Search != null });
            return Results.File(bytes, "text/csv; charset=utf-8", $"portalx-mailing-{DateTime.UtcNow:yyyy-MM-dd}.csv");
        });
    }
}

public sealed record MailingFilter(string? Search, string? Consent, string? Status, string? Game, DateTime? From, DateTime? To)
{
    public static MailingFilter Parse(HttpRequest r)
    {
        string? S(string k) => string.IsNullOrWhiteSpace(r.Query[k]) ? null : r.Query[k].ToString().Trim();
        static DateTime? D(string? s, bool end) => DateTime.TryParse(s, CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var d) ? (end && d.TimeOfDay == TimeSpan.Zero ? d.AddDays(1) : d) : null;
        return new MailingFilter(S("search")?.ToLowerInvariant(), S("consent"), S("status"), S("game"), D(S("from"), false), D(S("to"), true));
    }
}

public sealed record MailingRow(
    string Email, DateTime? LastResultsRequestAt, DateTime? LastSentAt, string? LastGame, string? LastGameName, string? ResultsStatus, int ResultsRequests,
    string Consent, DateTime? ConsentedAt, DateTime? RevokedAt, string? ConsentSource, bool GroupLinkRequested, string? Source);

/// <summary>
/// The admin's view of addresses: results requests, marketing consent and group-link requests side by side, each with
/// its own status. Only addresses with an active consent belong to the marketing list.
/// </summary>
public sealed class MailingAdmin(PortalDbContext db, UnsubscribeLinks links)
{
    public async Task<object> ListAsync(MailingFilter f)
    {
        var rows = await RowsAsync(f);
        return new
        {
            totals = new
            {
                // addresses that asked for results (service mail — not subscribers)
                resultsAddresses = await db.ResultEmailRequests.Select(x => x.Email).Distinct().CountAsync(),
                resultsSent = await db.ResultEmailRequests.CountAsync(x => x.Status == ResultEmailStatus.Sent),
                activeSubscribers = await db.MarketingConsents.CountAsync(x => x.Status == ConsentStatus.Active),
                revokedSubscribers = await db.MarketingConsents.CountAsync(x => x.Status == ConsentStatus.Revoked),
                groupLinkRequests = await db.CommunityLinkRequests.CountAsync(),
            },
            rows,
        };
    }

    public async Task<List<MailingRow>> RowsAsync(MailingFilter f)
    {
        var requests = await db.ResultEmailRequests.AsNoTracking().ToListAsync();
        var consents = await db.MarketingConsents.AsNoTracking().ToDictionaryAsync(x => x.Email);
        var groupEmails = (await db.CommunityLinkRequests.AsNoTracking().Where(x => x.Email != null).Select(x => x.Email!).ToListAsync()).ToHashSet();
        // a game's name by its scenario (several products may share one scenario: the first in the catalog names it)
        var names = (await db.Products.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync())
            .GroupBy(p => p.ScenarioId ?? p.Id).ToDictionary(g => g.Key, g => g.First().Name);
        var byEmail = requests.GroupBy(x => x.Email).ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.RequestedAt).ToList());
        var emails = byEmail.Keys.Union(consents.Keys).Union(groupEmails).Distinct();

        var rows = emails.Select(e =>
        {
            var reqs = byEmail.GetValueOrDefault(e) ?? [];
            var last = reqs.FirstOrDefault();
            var sentLast = reqs.FirstOrDefault(x => x.Status == ResultEmailStatus.Sent);
            consents.TryGetValue(e, out var c);
            var consent = c == null ? "none" : c.Status == ConsentStatus.Active ? "active" : c.Status == ConsentStatus.Revoked ? "revoked" : "pending";
            var lastGame = (sentLast ?? last)?.ScenarioId;
            return new MailingRow(e, last?.RequestedAt, reqs.Where(x => x.SentAt != null).Max(x => x.SentAt), lastGame, lastGame != null && names.TryGetValue(lastGame, out var n) ? n : lastGame,
                last == null ? null : last.Status == ResultEmailStatus.Sending ? "pending" : last.Status.ToString().ToLowerInvariant(), reqs.Count,
                consent, c?.ConsentedAt, c?.RevokedAt, c?.Source, groupEmails.Contains(e), last?.ScenarioId ?? c?.Source);
        });

        if (f.Search != null) rows = rows.Where(r => r.Email.Contains(f.Search));
        if (f.Consent != null) rows = rows.Where(r => r.Consent == f.Consent);
        if (f.Status != null) rows = rows.Where(r => r.ResultsStatus == f.Status);
        if (f.Game != null) rows = rows.Where(r => r.Source == f.Game || r.LastGame == f.Game);
        if (f.From is { } from) rows = rows.Where(r => (r.LastResultsRequestAt ?? r.ConsentedAt) >= from);
        if (f.To is { } to) rows = rows.Where(r => (r.LastResultsRequestAt ?? r.ConsentedAt) < to);
        return rows.OrderByDescending(r => r.LastResultsRequestAt ?? r.ConsentedAt).Take(5000).ToList();
    }

    public async Task<byte[]> CsvAsync(MailingFilter f, string siteUrl)
    {
        static string Cell(object? v)
        {
            var s = v switch
            {
                null => "",
                DateTime d => d.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + " UTC",
                bool b => b ? "כן" : "לא",
                _ => v.ToString() ?? "",
            };
            // no spreadsheet formulas from user data
            if (s.Length > 0 && "=+-@\t\r".Contains(s[0])) s = "'" + s;
            return s.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
        }
        static string Consent(string c) => c switch { "active" => "פעילה", "revoked" => "בוטלה", "pending" => "ממתינה לאימות", _ => "אין" };
        static string Status(string? s) => s switch { "sent" => "נשלח", "failed" => "נכשל", "pending" => "ממתין", "uncertain" => "לא ודאי", _ => "" };

        var rows = await RowsAsync(f);
        var consents = await db.MarketingConsents.AsNoTracking().Where(x => x.Status == ConsentStatus.Active).ToDictionaryAsync(x => x.Email);
        var sb = new StringBuilder("﻿");
        sb.AppendLine(string.Join(",", new[]
        {
            "כתובת מייל", "בקשת תוצאות אחרונה", "שליחה אחרונה", "משחק אחרון", "סטטוס שליחת תוצאות", "מספר בקשות תוצאות",
            "הסכמה שיווקית", "תאריך הסכמה", "מקור ההסכמה", "תאריך ביטול", "ביקש קישור לקבוצה", "מקור", "קישור הסרה (למנויים פעילים)",
        }.Select(Cell)));
        foreach (var r in rows)
        {
            // only active subscribers get an unsubscribe link, for use in a mailing tool
            var unsub = consents.TryGetValue(r.Email, out var c) ? await links.UrlAsync(c, siteUrl) : null;
            sb.AppendLine(string.Join(",", new object?[]
            {
                r.Email, r.LastResultsRequestAt, r.LastSentAt, r.LastGameName, Status(r.ResultsStatus), r.ResultsRequests,
                Consent(r.Consent), r.ConsentedAt, r.ConsentSource, r.RevokedAt, r.GroupLinkRequested, r.Source, unsub,
            }.Select(Cell)));
        }
        return Encoding.UTF8.GetBytes(sb.ToString());
    }
}

/// <summary>
/// Retention (spec 9): result-email requests and group-link requests are deleted after PORTALX_EMAIL_RETENTION_DAYS
/// (365 by default). Consent records stay — an active one is needed to mail, a revoked one keeps the address unmailed.
/// </summary>
public sealed class MailRetentionService(IServiceScopeFactory scopes, SiteOptions site, ILogger<MailRetentionService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await Task.Delay(TimeSpan.FromMinutes(2), stop).ContinueWith(_ => { });
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
                var before = DateTime.UtcNow.AddDays(-site.RetentionDays);
                var a = await db.ResultEmailRequests.Where(x => x.RequestedAt < before).ExecuteDeleteAsync(stop);
                var b = await db.CommunityLinkRequests.Where(x => x.RequestedAt < before).ExecuteDeleteAsync(stop);
                if (a + b > 0) logger.LogInformation("Retention: removed {Requests} result-email and {Group} group-link requests", a, b);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning("Retention run failed ({Type})", ex.GetType().Name);
            }
            await Task.Delay(TimeSpan.FromHours(24), stop).ContinueWith(_ => { });
        }
    }
}
