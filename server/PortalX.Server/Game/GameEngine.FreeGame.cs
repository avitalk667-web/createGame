using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>
/// "שער הסודות" 2.0 — the free game's remaining mechanisms. Only scenarios with these puzzle types reach this code (the
/// paid games have none of them):
///   cabinetlock — puzzle 3: four symbol wheels set in the rune order reveal ancient letters; their values open the code lock
///   keychest    — the bonus golden chest: the ancient key opens it (and stays in the bag)
///   levers      — puzzle 4: three chain levers, each pull raises one gauge and lowers the next, until all read the target
///   railway     — puzzle 5: the energy orb is steered junction by junction along a rail network to the core
///   gravity     — puzzle 6: the room turns over, three signs show on the ceiling, set in the right order they open the cell
/// The exit doors of both rooms are "exitdoor" puzzles (GameEngine.RoomExit.cs).
/// </summary>
public sealed partial class GameEngine
{
    /// <summary>A wrong code counts toward the lock's short cooldown, like a wrong answer (three in a row → 20 seconds).</summary>
    private string WrongCode(PuzzleState state, DateTime now, string message)
    {
        state.Attempts++;
        state.WrongStreak++;
        if (state.WrongStreak < options.WrongAttemptsBeforeCooldown) return message;
        state.WrongStreak = 0;
        state.CooldownUntil = now.AddSeconds(options.CooldownSeconds);
        return message + $" המנגנון ננעל ל־{options.CooldownSeconds} שניות — נצלו את הזמן לחשוב יחד.";
    }

    private static string CodeArg(JsonElement action) =>
        action.TryGetProperty("code", out var c) ? (c.ValueKind == JsonValueKind.String ? c.GetString() ?? "" : c.ToString()).Trim() : "";

    // ---------------------------------------------------------------- puzzle 3: the mechanical cabinet

    private ActionOutcome OperateCabinet(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var target = puzzle.Solution["wheels"]!.AsArray().Select(n => n!.GetValue<int>()).ToList();
        var letters = puzzle.Solution["letters"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        void Check()
        {
            mech.Ready = mech.Rotations.Select((r, k) => r == target[k]).All(x => x);
            // the letters on the backs show only while every wheel is right (the cover rises with them)
            mech.Backs = mech.Ready ? letters.Select((l, k) => (k, l)).ToDictionary(x => $"w{x.k + 1}", x => x.l) : new();
        }
        switch (op)
        {
            case "turn":
            {
                var k = action.TryGetProperty("wheel", out var w) && w.ValueKind == JsonValueKind.Number ? w.GetInt32() : -1;
                if (k < 0 || k >= mech.Rotations.Count) return ActionOutcome.Fail("bad-wheel", "הגלגל הזה לא קיים.");
                var was = mech.Ready;
                mech.Rotations[k] = (mech.Rotations[k] + 1) % 4;
                Check();
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                if (mech.Ready && !was)
                    return new ActionOutcome(true, "aligned", "נקישה! כל ארבעת הגלגלים במקומם — הכיסוי האבני עלה, ובגב הגלגלים נחשפו אותיות עתיקות.",
                        [new("cabinet-aligned", $"{player.Nickname} כיוון את הגלגל האחרון — הכיסוי שעל לוחית המספרים עלה", player.Id.ToString(), puzzle.Id)], true);
                return new ActionOutcome(true, "turned", "", [], true);
            }
            case "code":
            {
                if (!mech.Ready) return ActionOutcome.Fail("not-aligned", "לוחית המספרים עדיין מכוסה. קודם כוונו את ארבעת הגלגלים לפי רצף הרונים.");
                if (CodeArg(action) != puzzle.Solution["code"]!.GetValue<string>())
                {
                    var msg = WrongCode(state, now, puzzle.Failure);
                    return new ActionOutcome(false, "wrong", msg,
                        [new("wrong-answer", $"{player.Nickname} ניסה קוד בארון — הקוד שגוי", player.Id.ToString(), puzzle.Id)], true);
                }
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                return Solve(room, scenario, puzzle, state, player, now);
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }

    // ---------------------------------------------------------------- the bonus chest

    private ActionOutcome OperateKeyChest(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, string op, DateTime now)
    {
        if (op != "open") return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        var key = puzzle.PublicData["needsItem"]!.GetValue<string>();
        if (!world.Inventory.Contains(key))
            return ActionOutcome.Fail("no-key", puzzle.PublicData["noItemMessage"]?.GetValue<string>() ?? "התיבה נעולה.");
        Contribute(world, player.Id);
        state.Attempts++;
        SaveWorld(room, world, now);
        return Solve(room, scenario, puzzle, state, player, now);
    }

    // ---------------------------------------------------------------- puzzle 4: chains and levers

    /// <summary>Lever L raises its own gauge by one and lowers the next one (A→B, B→C, C→A); every gauge stays within 0–4.</summary>
    public static int[]? PullLever(IReadOnlyList<int> values, int lever, int max = 4)
    {
        var v = values.ToArray();
        var next = (lever + 1) % v.Length;
        v[lever]++;
        v[next]--;
        return v.All(x => x >= 0 && x <= max) ? v : null;
    }

    private ActionOutcome OperateLevers(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var names = puzzle.PublicData["levers"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        var max = puzzle.PublicData["max"]?.GetValue<int>() ?? 4;
        switch (op)
        {
            case "pull":
            {
                var name = action.TryGetProperty("lever", out var l) && l.ValueKind == JsonValueKind.String ? l.GetString() : null;
                var k = name == null ? -1 : names.IndexOf(name);
                if (k < 0) return ActionOutcome.Fail("bad-lever", "המנוף הזה לא קיים.");
                var next = PullLever(mech.Rotations, k, max);
                if (next == null)
                    return new ActionOutcome(false, "stuck", "השרשרת נתקעה ברעש מתכתי — המשיכה הזאת הייתה מוציאה מד מהטווח 0–4.",
                        [new("lever-stuck", $"{player.Nickname} משך את מנוף {name} — המנגנון תקוע", player.Id.ToString(), puzzle.Id)], false);
                mech.Rotations = next.ToList();
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                var goal = puzzle.Solution["target"]!.AsArray().Select(n => n!.GetValue<int>()).ToList();
                var line = new GameNotice("lever-pulled", $"{player.Nickname} משך את מנוף {name} · " + string.Join(" ", names.Select((n, i) => $"{n}={mech.Rotations[i]}")), player.Id.ToString(), puzzle.Id);
                if (!mech.Rotations.SequenceEqual(goal)) return new ActionOutcome(true, "pulled", "", [line], true);
                state.Attempts++;
                return Solve(room, scenario, puzzle, state, player, now, [line]);
            }
            case "reset":
                mech.Rotations = puzzle.PublicData["start"]!.AsArray().Select(n => n!.GetValue<int>()).ToList();
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "reset", "השרשראות חזרו למצב ההתחלה.",
                    [new("levers-reset", $"{player.Nickname} החזיר את המנופים למצב ההתחלה", player.Id.ToString(), puzzle.Id)], true);
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }

    // ---------------------------------------------------------------- puzzle 5: the energy rail

    /// <summary>
    /// The orb waits at the start ("S"); "start" sends it to the first junction. At a junction, "choose" moon/sun/star sends it
    /// along that rail: to another junction (it waits there), back to an earlier one, to the start (press "start" again), into a
    /// dead end (it stops — start again), or into the core (solved). Mech: Revealed = where the orb is; Input = the rails it
    /// went along since the last start (they glow behind it); Misses = dead ends.
    /// </summary>
    private ActionOutcome OperateRailway(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var graph = puzzle.Solution["graph"]!.AsObject();
        var first = puzzle.Solution["first"]!.GetValue<string>();
        mech.Revealed ??= "S";
        switch (op)
        {
            case "start":
            {
                if (mech.Revealed != "S" && mech.Revealed != "dead") return ActionOutcome.Fail("moving", "הכדור כבר על המסילות. בחרו מסילה בצומת.");
                mech.Revealed = first;
                mech.Input = ["S-" + first];
                mech.StartedAt = now;
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "started", "הכדור יצא לדרך ועצר בצומת הראשון. בחרו מסילה.",
                    [new("rail-start", $"{player.Nickname} שיגר את כדור האנרגיה", player.Id.ToString(), puzzle.Id)], true);
            }
            case "choose":
            {
                var at = mech.Revealed;
                if (at is "S" or "dead") return ActionOutcome.Fail("not-started", "הכדור עדיין בנקודת ההתחלה. לחצו „שיגור”.");
                var sym = action.TryGetProperty("rail", out var r) && r.ValueKind == JsonValueKind.String ? r.GetString()! : "";
                if (graph[at!]?[sym] is not JsonNode to) return ActionOutcome.Fail("bad-rail", "אין מסילה כזאת בצומת.");
                var dest = to.GetValue<string>();
                mech.Input ??= [];
                mech.Input.Add($"{at}-{sym}");
                mech.StartedAt = now;
                Contribute(world, player.Id);
                var notice = new GameNotice("rail-choose", $"{player.Nickname} כיוון את הכדור במסילת ה{RailName(sym)}", player.Id.ToString(), puzzle.Id);
                switch (dest)
                {
                    case "core":
                        mech.Revealed = "core";
                        state.Attempts++;
                        SaveWorld(room, world, now);
                        return Solve(room, scenario, puzzle, state, player, now, [notice]);
                    case "dead":
                        mech.Revealed = "dead";
                        mech.Misses++;
                        state.Attempts++;
                        SaveWorld(room, world, now);
                        return new ActionOutcome(true, "dead-end", "מבוי סתום! הכדור נעצר והמסילה מהבהבת באדום. לחצו „שיגור” כדי להתחיל מחדש.", [notice], true);
                    case "S":
                        mech.Revealed = "S";
                        SaveWorld(room, world, now);
                        return new ActionOutcome(true, "back-to-start", "המסילה הזאת מחזירה את הכדור לנקודת ההתחלה. לחצו „שיגור” כדי לנסות שוב.", [notice], true);
                    default:
                        var back = mech.Input.Any(e => e.StartsWith(dest + "-"));
                        mech.Revealed = dest;
                        SaveWorld(room, world, now);
                        return new ActionOutcome(true, "junction", back ? "המסילה החזירה את הכדור לצומת שכבר עבר בו." : "הכדור התקדם לצומת הבא. בחרו מסילה.", [notice], true);
                }
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }

    private static string RailName(string sym) => sym switch { "moon" => "ירח", "sun" => "שמש", "star" => "כוכב", _ => sym };

    // ---------------------------------------------------------------- puzzle 6: turning gravity over

    /// <summary>How long the room takes to turn over (the browsers animate it from StartedAt).</summary>
    public static readonly TimeSpan FlipTime = TimeSpan.FromSeconds(2);

    /// <summary>
    /// "flip" turns the room over (Running = upside down) or back; the three signs on the ceiling can be read only while it is
    /// upside down. "order" sets them into the cell in an order; the right one opens the cell and reveals the exit code
    /// (Revealed). After that, "flip" stays possible, so the group can turn the room back and walk to the gate.
    /// </summary>
    private ActionOutcome OperateGravity(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var turning = mech.StartedAt is { } s && now < s + FlipTime;
        switch (op)
        {
            case "flip":
            {
                if (turning) return ActionOutcome.Fail("turning", "החדר עדיין מסתובב — רגע אחד.");
                mech.Running = !mech.Running;
                mech.StartedAt = now;
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                return new ActionOutcome(true, mech.Running ? "flipped" : "restored",
                    mech.Running ? "העולם התהפך! מה שהיה תקרה הוא עכשיו רצפה — ושלושה סימנים נסתרים נחשפו." : "החדר חזר למצבו הרגיל.",
                    [new(mech.Running ? "gravity-flip" : "gravity-restore", mech.Running ? $"{player.Nickname} הפעיל את מוט הכבידה — החדר מתהפך!" : $"{player.Nickname} החזיר את החדר למצבו הרגיל", player.Id.ToString(), puzzle.Id)], true);
            }
            case "order":
            {
                if (state.Status == PuzzleStatus.Solved) return ActionOutcome.Fail("already-solved", "התא כבר פתוח.");
                if (!mech.Running || turning) return ActionOutcome.Fail("hidden", "הסימנים מוסתרים בתקרה. הפכו קודם את החדר בעזרת מוט הכבידה.");
                var signs = action.TryGetProperty("signs", out var a) && a.ValueKind == JsonValueKind.Array ? a.EnumerateArray().Select(x => x.GetString() ?? "").ToList() : [];
                var right = puzzle.Solution["order"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
                if (signs.Count != right.Count || signs.Distinct().Count() != right.Count || signs.Any(x => !right.Contains(x)))
                    return ActionOutcome.Fail("bad-order", "בחרו את שלושת הסימנים, כל אחד פעם אחת.");
                Contribute(world, player.Id);
                if (!signs.SequenceEqual(right))
                {
                    mech.Misses++;
                    state.Attempts++;
                    SaveWorld(room, world, now);
                    return new ActionOutcome(true, "wrong", "התא מהבהב והסימנים חוזרים למקומם. זה לא הסדר — קראו שוב את הכתובת שליד המוט.",
                        [new("cell-wrong", $"{player.Nickname} הכניס את הסימנים לתא — הסדר שגוי", player.Id.ToString(), puzzle.Id)], true);
                }
                mech.Input = signs;
                mech.Revealed = puzzle.Solution["exitCode"]!.GetValue<string>();
                state.Attempts++;
                SaveWorld(room, world, now);
                return Solve(room, scenario, puzzle, state, player, now);
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }
}
