using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;

namespace PortalX.Server.Admin;

public sealed record GameQuestionInput(string? ScenarioId, string? PuzzleId, string? Question, string? Answer, List<string>? Accept,
    string? Category, string? Difficulty, int? Points, bool? ClearPoints, int? SortOrder, bool? Active);

/// <summary>
/// "Game questions and answers" (not the site's FAQ): the admin replaces the question and answer of a game's question
/// puzzles. Everything is saved in the database; a game copies the active question when it starts (GameEngine.UseQuestions),
/// the answer is checked on the server only, and every change keeps the question as it was before and after.
/// </summary>
public static class GameQuestionEndpoints
{
    public static readonly string[] Difficulties = ["קלה", "בינונית", "קשה"];

    private static string Clean(string? s) => new string((s ?? "").Where(ch => !char.IsControl(ch)).ToArray()).Trim();

    /// <summary>The question puzzles of every game: where an admin question can be used.</summary>
    public static List<object> Slots(ScenarioCatalog catalog) => catalog.All.OrderBy(s => s.Id).SelectMany(s => s.Puzzles
        .Where(p => GameEngine.QuestionField(p) != null).OrderBy(p => s.Zones.First(z => z.Id == p.Zone).Order).ThenBy(p => p.Order)
        .Select(p => (object)new
        {
            scenarioId = s.Id, game = s.Name, puzzleId = p.Id, zone = p.Zone, zoneName = s.Zones.First(z => z.Id == p.Zone).Name, title = p.Title,
            field = GameEngine.QuestionField(p),
            // the built-in version, shown to the admin only
            builtInQuestion = p.PublicData[GameEngine.QuestionField(p)!]!.GetValue<string>(),
            builtInAnswer = p.Solution["text"]!.GetValue<string>(),
            builtInAccept = p.Solution["accept"]?.AsArray().Select(n => n!.GetValue<string>()).ToList() ?? [],
            builtInPoints = s.Scoring?.Answer,
            hasOptions = p.PublicData["options"] != null,
        })).ToList();

    private static object Snapshot(GameQuestion q) => new
    {
        q.ScenarioId, q.PuzzleId, q.Zone, q.Question, q.Answer,
        accept = JsonSerializer.Deserialize<List<string>>(q.AcceptJson, ScenarioCatalog.JsonOptions), q.Category, q.Difficulty, q.Points,
        q.SortOrder, q.Active, q.Version,
    };

    private static object View(GameQuestion q) => new
    {
        q.Id, q.ScenarioId, q.PuzzleId, q.Zone, q.Question, q.Answer,
        accept = JsonSerializer.Deserialize<List<string>>(q.AcceptJson, ScenarioCatalog.JsonOptions), q.Category, q.Difficulty, q.Points,
        q.SortOrder, q.Active, q.Version, q.CreatedBy, q.CreatedAt, q.UpdatedBy, q.UpdatedAt,
    };

    private static string? Validate(GameQuestion q, ScenarioCatalog catalog)
    {
        var p = catalog.Find(q.ScenarioId)?.Puzzles.FirstOrDefault(x => x.Id == q.PuzzleId);
        if (p == null || GameEngine.QuestionField(p) == null) return "יש לבחור משחק וחידת שאלה מהרשימה.";
        if (q.Question.Length is < 3 or > 500) return "נוסח השאלה צריך להיות באורך 3–500 תווים.";
        if (q.Answer.Length is < 1 or > 100) return "התשובה הנכונה צריכה להיות באורך 1–100 תווים.";
        if (GameEngine.NormalizeText(q.Answer).Length == 0) return "התשובה הנכונה צריכה להכיל אותיות או ספרות.";
        var accept = JsonSerializer.Deserialize<List<string>>(q.AcceptJson, ScenarioCatalog.JsonOptions) ?? [];
        if (accept.Count > 10 || accept.Any(a => a.Length is < 1 or > 100)) return "אפשר עד 10 תשובות חלופיות, כל אחת עד 100 תווים.";
        if (q.Category.Length > 60) return "הקטגוריה יכולה להכיל עד 60 תווים.";
        if (!Difficulties.Contains(q.Difficulty)) return "יש לבחור רמת קושי: קלה, בינונית או קשה.";
        if (q.Points is < 0 or > 500) return "הניקוד צריך להיות בין 0 ל־500.";
        if (q.SortOrder is < 0 or > 10000) return "הסדר צריך להיות מספר בין 0 ל־10000.";
        return null;
    }

    private static void Apply(GameQuestion q, GameQuestionInput u)
    {
        if (u.ScenarioId != null) q.ScenarioId = Clean(u.ScenarioId);
        if (u.PuzzleId != null) q.PuzzleId = Clean(u.PuzzleId);
        if (u.Question != null) q.Question = Clean(u.Question);
        if (u.Answer != null) q.Answer = Clean(u.Answer);
        if (u.Accept != null)
            q.AcceptJson = JsonSerializer.Serialize(u.Accept.Select(Clean).Where(a => a.Length > 0).Distinct().ToList(), ScenarioCatalog.JsonOptions);
        if (u.Category != null) q.Category = Clean(u.Category);
        if (u.Difficulty != null) q.Difficulty = Clean(u.Difficulty);
        if (u.ClearPoints == true) q.Points = null;
        else if (u.Points != null) q.Points = u.Points;
        if (u.SortOrder != null) q.SortOrder = u.SortOrder.Value;
        if (u.Active != null) q.Active = u.Active.Value;
    }

    public static void MapGameQuestionEndpoints(this RouteGroupBuilder secured)
    {
        secured.MapGet("/game-questions", async (PortalDbContext db, ScenarioCatalog catalog) => Results.Ok(new
        {
            slots = Slots(catalog),
            difficulties = Difficulties,
            questions = (await db.GameQuestions.AsNoTracking().OrderBy(q => q.ScenarioId).ThenBy(q => q.PuzzleId).ThenBy(q => q.SortOrder).ThenBy(q => q.CreatedAt)
                .ToListAsync()).Select(View),
        }));

        secured.MapGet("/game-questions/{id:guid}/revisions", async (Guid id, PortalDbContext db) => Results.Ok(
            (await db.GameQuestionRevisions.AsNoTracking().Where(r => r.QuestionId == id).OrderByDescending(r => r.At).Take(100).ToListAsync())
                .Select(r => new { r.Id, r.Version, r.Action, before = r.BeforeJson == null ? (JsonElement?)null : JsonDocument.Parse(r.BeforeJson).RootElement, after = JsonDocument.Parse(r.AfterJson).RootElement, r.Admin, r.At })));

        secured.MapPost("/game-questions", async (GameQuestionInput u, HttpContext ctx, PortalDbContext db, ScenarioCatalog catalog, AdminService s) =>
        {
            var admin = AdminAuth.Name(ctx.User);
            var now = DateTime.UtcNow;
            var q = new GameQuestion { Id = Guid.NewGuid(), Difficulty = "בינונית", Active = true, Version = 1, CreatedBy = admin, CreatedAt = now, UpdatedBy = admin, UpdatedAt = now };
            Apply(q, u);
            var puzzle = catalog.Find(q.ScenarioId)?.Puzzles.FirstOrDefault(x => x.Id == q.PuzzleId);
            q.Zone = puzzle?.Zone ?? "";
            if (u.SortOrder == null)
                q.SortOrder = (await db.GameQuestions.Where(x => x.ScenarioId == q.ScenarioId && x.PuzzleId == q.PuzzleId).MaxAsync(x => (int?)x.SortOrder) ?? 0) + 1;
            if (Validate(q, catalog) is { } err) return Results.BadRequest(new ApiError("invalid", err));
            db.GameQuestions.Add(q);
            db.GameQuestionRevisions.Add(new GameQuestionRevision
            {
                QuestionId = q.Id, Version = q.Version, Action = "created", AfterJson = JsonSerializer.Serialize(Snapshot(q), ScenarioCatalog.JsonOptions), Admin = admin, At = now,
            });
            await db.SaveChangesAsync();
            await s.AuditAsync(admin, "game-question-added", "game-question", q.Id.ToString(), new { q.ScenarioId, q.PuzzleId });
            return Results.Ok(View(q));
        });

        secured.MapPut("/game-questions/{id:guid}", async (Guid id, GameQuestionInput u, HttpContext ctx, PortalDbContext db, ScenarioCatalog catalog, AdminService s) =>
        {
            var q = await db.GameQuestions.FirstOrDefaultAsync(x => x.Id == id);
            if (q == null) return Results.NotFound(new ApiError("no-question", "השאלה לא נמצאה."));
            var admin = AdminAuth.Name(ctx.User);
            var before = JsonSerializer.Serialize(Snapshot(q), ScenarioCatalog.JsonOptions);
            Apply(q, u);
            q.Zone = catalog.Find(q.ScenarioId)?.Puzzles.FirstOrDefault(x => x.Id == q.PuzzleId)?.Zone ?? "";
            if (Validate(q, catalog) is { } err) return Results.BadRequest(new ApiError("invalid", err));
            var after = JsonSerializer.Serialize(Snapshot(q), ScenarioCatalog.JsonOptions);
            if (after == before) return Results.Ok(View(q));
            q.Version++;
            q.UpdatedBy = admin;
            q.UpdatedAt = DateTime.UtcNow;
            db.GameQuestionRevisions.Add(new GameQuestionRevision
            {
                QuestionId = q.Id, Version = q.Version, Action = "updated", BeforeJson = before,
                AfterJson = JsonSerializer.Serialize(Snapshot(q), ScenarioCatalog.JsonOptions), Admin = admin, At = q.UpdatedAt,
            });
            await db.SaveChangesAsync();
            await s.AuditAsync(admin, "game-question-updated", "game-question", q.Id.ToString(), new { q.ScenarioId, q.PuzzleId, q.Version, q.Active });
            return Results.Ok(View(q));
        });
    }
}
