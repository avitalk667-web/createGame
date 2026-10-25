using System.Net.Mail;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;

namespace PortalX.Server.Mail;

/// <summary>What the player chose at the end of the game; each choice stands on its own (spec 3).</summary>
public sealed record EndOfGameChoices(string? Token, bool SendResults, string? Email, bool MarketingConsent, bool CommunityLink);

public sealed record EndOfGameReply(bool Ok, string Code, string Message, string? ResultsStatus = null, bool ConsentRecorded = false,
    string? CommunityGroupUrl = null);

/// <summary>
/// The end-of-game choices: the results email (a service email), marketing consent and the group link — three separate
/// records. Mail goes out from the server only, built from the stored game data, once per player and round.
/// </summary>
public sealed partial class ResultsEmailService(
    PortalDbContext db, RoomService rooms, ScenarioCatalog scenarios, IEmailSender sender, SiteOptions site,
    UnsubscribeLinks links, ILogger<ResultsEmailService> logger)
{
    public const string ConsentVersion = "2026-10-v1";
    public const string ConsentText = "אני מסכים/ה לקבל מיילים שיווקיים ועדכונים מ-PORTAL X על משחקים חדשים, הטבות, קופונים ותכנים נוספים. ניתן להסיר את ההסכמה בכל עת.";
    public const string SentMessage = "התוצאות נשלחו! כדאי לבדוק גם בתיקיית הספאם.";
    public const string FailedMessage = "לא הצלחנו לשלוח את המייל כרגע. התוצאות שמורות — אפשר לנסות שוב בעוד רגע.";
    public const string UncertainMessage = "לא ברור אם המייל נשלח (החיבור נקטע). בדקו בעוד כמה דקות את תיבת הדואר וגם את תיקיית הספאם; אם לא הגיע, אפשר לנסות שוב.";
    public const string BadEmailMessage = "כתובת המייל אינה תקינה. בדקו אותה ונסו שוב.";
    public const int MaxAttempts = 6;
    private static readonly TimeSpan StaleSending = TimeSpan.FromMinutes(2);

    [GeneratedRegex(@"^[^\s@<>()\[\],;:""\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$")]
    private static partial Regex EmailShape();

    /// <summary>A usable address, lower-cased — or null. Checked on the server whatever the browser said.</summary>
    public static string? NormalizeEmail(string? email)
    {
        var e = email?.Trim();
        if (string.IsNullOrEmpty(e) || e.Length > 254 || !EmailShape().IsMatch(e)) return null;
        try
        {
            var parsed = new MailAddress(e);
            return parsed.Address == e ? e.ToLowerInvariant() : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    public async Task<(EndOfGameReply Reply, int Status)> HandleAsync(string code, EndOfGameChoices c, string? seatCookieToken, string requestSiteUrl)
    {
        var room = await rooms.FindByCodeAsync(code);
        if (room == null) return (new(false, "no-room", "המשחק לא נמצא."), 404);
        // the player is known only by their own seat token (sent in the body or the game's seat cookie) — never by a URL
        var token = !string.IsNullOrWhiteSpace(c.Token) ? c.Token : seatCookieToken;
        var player = string.IsNullOrEmpty(token) ? null : room.Players.FirstOrDefault(p => p.TokenHash == RoomService.Hash(token));
        if (player == null) return (new(false, "not-in-room", "רק משתתף במשחק יכול לבקש את התוצאות שלו."), 403);
        if (room.Phase != RoomPhase.Completed) return (new(false, "not-finished", "התוצאות יהיו זמינות בסיום המשחק."), 409);
        if (!c.SendResults && !c.MarketingConsent && !c.CommunityLink) return (new(false, "nothing-chosen", "לא נבחרה אף אפשרות."), 400);

        string? email = null;
        if (c.SendResults || c.MarketingConsent)
        {
            email = NormalizeEmail(c.Email);
            if (email == null) return (new(false, "bad-email", BadEmailMessage), 400);
        }
        if (c.SendResults && !await sender.IsAvailableAsync())
            return (new(false, "email-unavailable", "שליחת תוצאות במייל עדיין לא זמינה באתר. התוצאות מוצגות על המסך."), 503);
        if (c.CommunityLink && site.CommunityGroupUrl == null)
            return (new(false, "no-group", "קבוצת העדכונים עדיין לא זמינה."), 409);

        var now = DateTime.UtcNow;
        var source = room.ScenarioId;
        var consentRecorded = false;
        if (c.MarketingConsent) consentRecorded = await RecordConsentAsync(email!, source, room.Id, now);
        string? groupUrl = null;
        if (c.CommunityLink)
        {
            await RecordGroupRequestAsync(room, player, email, now);
            groupUrl = site.CommunityGroupUrl;
        }
        if (!c.SendResults)
            return (new(true, "saved", consentRecorded ? "ההסכמה נשמרה. תודה!" : "הבחירה נשמרה.", null, consentRecorded, groupUrl), 200);

        var reply = await SendResultsAsync(room, player, email!, site.SiteUrl ?? requestSiteUrl, now);
        // a failed or pending send is still an answer: the consent and group choices above were saved, and the page offers a retry
        return (reply with { ConsentRecorded = consentRecorded, CommunityGroupUrl = groupUrl }, 200);
    }

    private async Task<bool> RecordConsentAsync(string email, string source, Guid roomId, DateTime now)
    {
        var consent = await db.MarketingConsents.FirstOrDefaultAsync(x => x.Email == email);
        if (consent is { Status: ConsentStatus.Active }) return true;
        if (consent == null)
        {
            consent = new MarketingConsent { Id = Guid.NewGuid(), Email = email };
            db.MarketingConsents.Add(consent);
        }
        // a new, explicit tick: active again from now, with a fresh unsubscribe link (old links stop working)
        consent.Status = ConsentStatus.Active;
        consent.ConsentedAt = now;
        consent.Source = source;
        consent.SourceRoomId = roomId;
        consent.ConsentVersion = ConsentVersion;
        consent.ConsentText = ConsentText;
        consent.RevokedAt = null;
        consent.TokenStamp = UnsubscribeLinks.NewStamp();
        consent.UpdatedAt = now;
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // the same address consented at the same moment elsewhere: that record stands
            db.ChangeTracker.Clear();
        }
        logger.LogInformation("Marketing consent recorded (source {Source})", source);
        return true;
    }

    private async Task RecordGroupRequestAsync(GameRoom room, PlayerSession player, string? email, DateTime now)
    {
        if (await db.CommunityLinkRequests.AnyAsync(x => x.RoomId == room.Id && x.Round == room.Round && x.PlayerId == player.Id)) return;
        db.CommunityLinkRequests.Add(new CommunityLinkRequest
        {
            Id = Guid.NewGuid(), RoomId = room.Id, Round = room.Round, PlayerId = player.Id, Source = room.ScenarioId, Email = email, RequestedAt = now,
        });
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); }
    }

    private async Task<EndOfGameReply> SendResultsAsync(GameRoom room, PlayerSession player, string email, string siteUrl, DateTime now)
    {
        var key = $"{room.Id:N}:{room.Round}:{player.Id:N}";
        var req = await db.ResultEmailRequests.FirstOrDefaultAsync(x => x.IdempotencyKey == key);
        if (req is { Status: ResultEmailStatus.Sent })
            return new(true, "already-sent", "התוצאות של המשחק הזה כבר נשלחו למייל. כדאי לבדוק גם בתיקיית הספאם.", "sent");
        if (req is { Status: ResultEmailStatus.Sending } && req.LastAttemptAt > now - StaleSending)
            return new(false, "in-progress", "המייל כבר בדרך. נסו לרענן בעוד רגע.", "pending");
        if (req is { Attempts: >= MaxAttempts })
            return new(false, "too-many", "ניסינו כמה פעמים ולא הצלחנו לשלוח. אפשר לפנות אלינו בכתובת " + site.ContactEmail, "failed");

        var result = await db.Results.AsNoTracking().Where(r => r.RoomId == room.Id && r.Round == room.Round)
            .OrderByDescending(r => r.CreatedAt).FirstOrDefaultAsync();
        if (req == null)
        {
            req = new ResultEmailRequest
            {
                Id = Guid.NewGuid(), IdempotencyKey = key, RoomId = room.Id, Round = room.Round, PlayerId = player.Id,
                GameResultId = result?.Id, ScenarioId = room.ScenarioId, ProductId = room.ProductId, Email = email,
                GameEndedAt = room.EndedAt, RequestedAt = now, Status = ResultEmailStatus.Pending,
            };
            db.ResultEmailRequests.Add(req);
            try
            {
                await db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // the same request arrived twice at once: the other one sends it
                db.ChangeTracker.Clear();
                return new(false, "in-progress", "המייל כבר בדרך. נסו לרענן בעוד רגע.", "pending");
            }
        }

        // claim the send atomically, so two clicks or two tabs can never send the same results twice
        var staleBefore = now - StaleSending;
        var claimed = await db.ResultEmailRequests
            .Where(x => x.Id == req.Id && x.Status != ResultEmailStatus.Sent
                && (x.Status != ResultEmailStatus.Sending || x.LastAttemptAt < staleBefore))
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.Status, ResultEmailStatus.Sending)
                .SetProperty(x => x.Email, email)
                .SetProperty(x => x.LastAttemptAt, now));
        if (claimed == 0) return new(false, "in-progress", "המייל כבר בדרך. נסו לרענן בעוד רגע.", "pending");

        var message = await BuildMessageAsync(room, player, result, email, siteUrl);
        string? error = null;
        string? messageId = null;
        var uncertain = false;
        var attempts = 0;
        // one short retry for a temporary server error only; quota, a refused address, a lost grant or an uncertain
        // outcome are never retried automatically
        for (var i = 0; i < 2; i++)
        {
            attempts++;
            try
            {
                messageId = await sender.SendAsync(message);
                error = null;
                break;
            }
            catch (EmailSendException ex)
            {
                error = ex.Code;
                uncertain = ex.Uncertain;
                if (!ex.Transient || ex.Uncertain || ex.Code is "quota" or "google-unreachable") break;
                await Task.Delay(400);
            }
        }

        // "sent" only with the provider's confirmation (its message id) — and only after the status is saved
        var done = error == null && !string.IsNullOrEmpty(messageId);
        var status = done ? ResultEmailStatus.Sent : uncertain ? ResultEmailStatus.Uncertain : ResultEmailStatus.Failed;
        await db.ResultEmailRequests.Where(x => x.Id == req.Id).ExecuteUpdateAsync(s => s
            .SetProperty(x => x.Status, status)
            .SetProperty(x => x.Attempts, x => x.Attempts + attempts)
            .SetProperty(x => x.LastAttemptAt, DateTime.UtcNow)
            .SetProperty(x => x.SentAt, x => done ? DateTime.UtcNow : x.SentAt)
            .SetProperty(x => x.ProviderMessageId, x => done ? messageId : x.ProviderMessageId)
            .SetProperty(x => x.LastError, done ? null : error ?? "no-message-id"));
        // the log names the request, never the address
        if (done) logger.LogInformation("Results email {Request} sent for room {Code}", req.Id, room.Code);
        else logger.LogWarning("Results email {Request} for room {Code} not confirmed: {Error}", req.Id, room.Code, error);
        if (done) return new(true, "sent", SentMessage, "sent");
        if (uncertain) return new(false, "send-uncertain", UncertainMessage, "uncertain");
        return new(false, "send-failed", FailedMessage, "failed");
    }

    /// <summary>The email's content, from the stored result and scores of this game only.</summary>
    public async Task<EmailMessage> BuildMessageAsync(GameRoom room, PlayerSession player, GameResult? result, string email, string siteUrl)
    {
        var scenario = scenarios.Get(room.ScenarioId);
        var productName = room.ProductId == null ? null
            : await db.Products.AsNoTracking().Where(p => p.Id == room.ProductId).Select(p => p.Name).FirstOrDefaultAsync();
        var world = GameEngine.World(room);
        IReadOnlyList<TeamScore> team = [];
        int? personal = null, rank = null, group = null;
        var tie = false;
        if (scenario.Scoring != null && world.Score != null)
        {
            var ranking = GameEngine.Ranking(room, world);
            team = ranking.Select(r => new TeamScore(r.Player.Nickname, r.Points, r.Rank, r.Player.Id == player.Id)).ToList();
            var mine = ranking.Where(r => r.Player.Id == player.Id).ToList();
            if (mine.Count > 0)
            {
                personal = mine[0].Points;
                rank = mine[0].Rank;
            }
            group = world.Score.Group;
            tie = ranking.Count(r => r.Rank == 1) > 1;
        }
        var achievements = result == null ? []
            : (JsonSerializer.Deserialize<List<AchievementContent>>(result.AchievementsJson, ScenarioCatalog.JsonOptions) ?? [])
                .Select(a => new EarnedAchievement(a.Title, a.Description)).ToList();
        var consent = await db.MarketingConsents.AsNoTracking().FirstOrDefaultAsync(x => x.Email == email && x.Status == ConsentStatus.Active);
        var model = new ResultsEmailModel(
            productName ?? scenario.Name, room.EndedAt, player.Nickname, personal, rank, tie, team, group,
            result?.DurationSeconds, result?.PuzzlesSolved, result?.PuzzlesTotal,
            result?.PlayersCount ?? GameEngine.ActivePlayers(room).Count(), achievements,
            siteUrl.TrimEnd('/'), site.ContactEmail, consent == null ? null : await links.UrlAsync(consent, siteUrl));
        return new EmailMessage(email, ResultsEmailTemplate.Subject(model), ResultsEmailTemplate.Html(model), ResultsEmailTemplate.Text(model), model.UnsubscribeUrl);
    }
}
