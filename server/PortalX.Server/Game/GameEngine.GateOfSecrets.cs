using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>
/// The free game "שער הסודות", room 1 — the parts no other game reaches. Each one is switched on only by its own flag in
/// the scenario file (no other scenario has them), so the paid games keep exactly the behaviour they had:
///   slots "checkWhole"     — nothing is judged while placing; the check says only whether the whole arrangement is right
///   slots "generatedBacks" — the digits on the backs of the arranged pieces are drawn for each game (books' spines)
///   type "compass"         — turn the needle to a mark and press it; on the right mark it flashes a purple arrow that
///                            only one player (its holder) sees for a moment
///   cipher "generatedFrom" — the code is made from this game's digits, read in the direction the arrow shows
/// The drawn values live in <see cref="WorldState.Secrets"/>, which is never part of what the clients receive.
/// </summary>
public sealed partial class GameEngine
{
    /// <summary>How long after its flash ends the compass may flash again (so a group can always see it once more).</summary>
    public static readonly TimeSpan CompassRepeatAfter = TimeSpan.FromSeconds(4);

    /// <summary>A little time past the flash in which its holder may still fetch it (the network is not instant).</summary>
    public static readonly TimeSpan CompassFetchGrace = TimeSpan.FromSeconds(2);

    private static PuzzleContent? GeneratedPuzzle(ScenarioContent s) =>
        s.Puzzles.FirstOrDefault(p => p.Type == "slots" && p.PublicData["generatedBacks"]?.GetValue<bool>() == true);

    /// <summary>Draws this game's secrets (only for a scenario that asks for them; any other game keeps no secrets).</summary>
    private static void GenerateSecrets(ScenarioContent scenario, WorldState world)
    {
        var books = GeneratedPuzzle(scenario);
        if (books == null) return;
        var pieces = books.PublicData["accepts"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        // distinct digits 1–9: no 0, and the code read forwards never equals the code read backwards
        var pool = Enumerable.Range(1, 9).ToList();
        var secrets = new Dictionary<string, string>();
        foreach (var piece in pieces)
        {
            var k = RandomNumberGenerator.GetInt32(pool.Count);
            secrets[$"digit:{piece}"] = pool[k].ToString();
            pool.RemoveAt(k);
        }
        // the purple arrow points at one end of the shelf: the first or the last place
        var order = SolvedOrder(books);
        secrets["arrow"] = RandomNumberGenerator.GetInt32(2) == 0 ? order[0] : order[^1];
        world.Secrets = secrets;
    }

    /// <summary>This game's secrets; a game that began before they existed draws them now (once, then they never change).</summary>
    private Dictionary<string, string>? Secrets(GameRoom room, ScenarioContent scenario, WorldState world, DateTime now)
    {
        if (GeneratedPuzzle(scenario) == null) return null;
        if (world.Secrets is { Count: > 0 } s) return s;
        GenerateSecrets(scenario, world);
        SaveWorld(room, world, now);
        return world.Secrets;
    }

    /// <summary>The pieces in their right places, place by place (the order of the solution's slots).</summary>
    private static List<string> SolvedOrder(PuzzleContent slots)
    {
        var solution = slots.Solution["slots"]!.AsObject();
        return slots.PublicData["slots"]!.AsArray().Select(n => solution[n!["id"]!.GetValue<string>()]!.GetValue<string>()).ToList();
    }

    /// <summary>The right code of a "generatedFrom" lock: the digits in shelf order, from the end the arrow points at.</summary>
    public static string GeneratedCode(ScenarioContent scenario, WorldState world)
    {
        var books = GeneratedPuzzle(scenario)!;
        var order = SolvedOrder(books);
        var s = world.Secrets!;
        if (s["arrow"] == order[^1]) order.Reverse();
        return string.Concat(order.Select(b => s[$"digit:{b}"]));
    }

    /// <summary>
    /// The answer to a lock whose code is drawn for each game, or null for every other puzzle (they keep their own check).
    /// </summary>
    private bool? GeneratedAnswer(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, JsonElement answer, DateTime now)
    {
        if (puzzle.Solution["generatedFrom"] is not JsonValue) return null;
        if (Secrets(room, scenario, World(room), now) == null) return false;
        var given = answer.ValueKind switch
        {
            JsonValueKind.String => answer.GetString() ?? "",
            JsonValueKind.Array => string.Concat(answer.EnumerateArray().Select(e => e.ToString())),
            JsonValueKind.Object when answer.TryGetProperty("text", out var t) => t.ToString(),
            _ => "",
        };
        return NormalizeText(given) == GeneratedCode(scenario, World(room));
    }

    /// <summary>The digits that appear on the pieces once the arrangement is right, place by place.</summary>
    private void RevealGeneratedBacks(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, WorldState world, MechanismState mech, DateTime now)
    {
        if (puzzle.PublicData["generatedBacks"]?.GetValue<bool>() != true) return;
        var s = Secrets(room, scenario, world, now)!;
        mech.Backs = mech.Slots.ToDictionary(kv => kv.Key, kv => s.GetValueOrDefault($"digit:{kv.Value}") ?? "");
    }

    // ---------------------------------------------------------------- the compass

    private ActionOutcome OperateCompass(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var marks = puzzle.PublicData["marks"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();
        var label = (int i) => puzzle.PublicData["marks"]![i]!["label"]!.GetValue<string>();
        var hold = TimeSpan.FromSeconds(puzzle.PublicData["holdSeconds"]?.GetValue<double>() ?? 2.2);
        var solved = state.Status == PuzzleStatus.Solved;
        switch (op)
        {
            case "turn":
            {
                if (solved) return ActionOutcome.Fail("already-solved", "המצפן כבר התעורר. לחצו עליו כדי לראות שוב את ההבזק.");
                var dir = action.TryGetProperty("dir", out var d) && d.ValueKind == JsonValueKind.Number && d.GetInt32() < 0 ? -1 : 1;
                mech.Progress = ((mech.Progress + dir) % marks.Count + marks.Count) % marks.Count;
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "turned", $"המחט מצביעה על {label(mech.Progress)}",
                    [new("puzzle-action", $"{player.Nickname} · {puzzle.Title}: סובב את המחט אל {label(mech.Progress)}", player.Id.ToString(), puzzle.Id)], true);
            }
            case "press":
            {
                if (solved)
                {
                    // the flash again, for whoever missed it — a short pause between two flashes
                    if (mech.ControlUntil is { } end && now < end + CompassRepeatAfter)
                        return ActionOutcome.Fail("cooldown", "המצפן עוד מתאושש מההבזק. נסו שוב בעוד רגע.");
                    mech.ControlUntil = now + hold;
                    mech.StartedAt = now;
                    SaveWorld(room, world, now);
                    return new ActionOutcome(true, "flash", "המצפן הבזיק שוב באור סגול!",
                        [new("compass-flash", $"{player.Nickname} הפעיל שוב את המצפן — הבזק סגול!", player.Id.ToString(), puzzle.Id)], true);
                }
                if (marks[mech.Progress] != puzzle.Solution["target"]!.GetValue<string>())
                {
                    var msg = WrongCode(state, now, puzzle.Failure);
                    SaveWorld(room, world, now);
                    return new ActionOutcome(false, "wrong-answer", msg, [new("wrong-answer", $"{player.Nickname} · {puzzle.Title}: {puzzle.Failure}", player.Id.ToString(), puzzle.Id)], true);
                }
                state.Attempts++;
                state.WrongStreak = 0;
                mech.ControlUntil = now + hold;
                mech.StartedAt = now;
                mech.Ready = true;
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                return Solve(room, scenario, puzzle, state, player, now,
                    [new("compass-flash", $"{player.Nickname} העיר את המצפן — הבזק סגול!", player.Id.ToString(), puzzle.Id)]);
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }

    /// <summary>
    /// What the compass's flash showed, for its holder only (the player the scenario's "oneHolder" rule picks, or anyone
    /// once that player has been away a while), and only while the flash lasts. Everyone else gets nothing.
    /// </summary>
    private ActionOutcome CompassFlash(GameRoom room, PuzzleContent puzzle, Guid playerId, DateTime now)
    {
        var scenario = catalog.Get(room.ScenarioId);
        var world = World(room);
        var mech = world.Mechanisms.GetValueOrDefault(puzzle.Id);
        var data = new JsonObject
        {
            ["clues"] = new JsonArray(),
            ["holdMs"] = (int)((puzzle.PublicData["holdSeconds"]?.GetValue<double>() ?? 2.2) * 1000),
            ["solo"] = ActivePlayers(room).Count() == 1,
        };
        if (mech?.ControlUntil is not { } end || now > end + CompassFetchGrace)
            return new ActionOutcome(true, "ok", "", Array.Empty<GameNotice>(), false, data);
        var holder = CluesForPlayer(room, puzzle, playerId).Count > 0;
        var away = !holder ? AwayClues(room, puzzle, playerId, now).FirstOrDefault() : default;
        if (!holder && away.Clue == null) return new ActionOutcome(true, "ok", "", Array.Empty<GameNotice>(), false, data);
        // a read never draws (it is not saved): the books, solved before the compass, have drawn this game's values already
        if (world.Secrets is not { } s || !s.ContainsKey("arrow")) return new ActionOutcome(true, "ok", "", Array.Empty<GameNotice>(), false, data);
        var book = scenario.Item(s["arrow"]);
        var clue = puzzle.PersonalClues[0];
        var o = new JsonObject
        {
            ["index"] = clue.Index, ["title"] = clue.Title,
            ["text"] = clue.Text.Replace("{book}", book?.Name ?? ""), ["visual"] = s["arrow"],
        };
        if (!holder) { o["away"] = true; o["from"] = away.Owner; }
        data["clues"]!.AsArray().Add(o);
        return new ActionOutcome(true, "ok", "", Array.Empty<GameNotice>(), false, data);
    }
}
