using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace PortalX.Server.Content;

public sealed class ScenarioContent
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Tagline { get; init; }
    public required string Description { get; init; }
    public required string DurationMinutes { get; init; }
    public required string Difficulty { get; init; }
    public int MinPlayers { get; init; } = 1;
    public int MaxPlayers { get; init; } = 4;
    /// <summary>Shown in the lobby while fewer than MinPlayers are present (e.g. a game that needs at least two).</summary>
    public string? MinPlayersMessage { get; init; }
    /// <summary>Shown to a player who cannot join because the game is full; the general message is used otherwise.</summary>
    public string? FullMessage { get; init; }
    public required string FinalWord { get; init; }
    public required List<ZoneContent> Zones { get; init; }
    public required List<ItemContent> Items { get; init; }
    public required List<RecipeContent> Recipes { get; init; }
    public required List<PuzzleContent> Puzzles { get; init; }
    public required List<AchievementContent> Achievements { get; init; }
    /// <summary>Clues that can be discovered in the rooms (first discoverer scores). Public content.</summary>
    public List<ClueContent> Clues { get; init; } = new();
    /// <summary>Difficulty per zone ("easy" / "medium" / "medium-hard" / "hard"), used for the group score.</summary>
    public Dictionary<string, string> ZoneDifficulty { get; init; } = new();
    /// <summary>Scoring values. When null the scenario has no scoring (the original game).</summary>
    public ScoringRules? Scoring { get; init; }
    /// <summary>Secret personal tasks: in each listed room every player gets one of them, shown to that player only.</summary>
    public List<PersonalTaskContent> PersonalTasks { get; init; } = new();
    /// <summary>Personal titles given at the end of the game to the players with the most verified events of a kind.</summary>
    public List<PersonalTitleContent> Titles { get; init; } = new();
    /// <summary>Length of this scenario's opening scene; null = the server default.</summary>
    public int? IntroSeconds { get; init; }

    public PuzzleContent Puzzle(string id) =>
        Puzzles.FirstOrDefault(p => p.Id == id) ?? throw new KeyNotFoundException($"Puzzle {id} not found");

    public ItemContent? Item(string id) => Items.FirstOrDefault(i => i.Id == id);
}

/// <summary>A secret personal task: what the player is asked to find, and what they read when they find it.</summary>
public sealed record PersonalTaskContent(string Id, string Zone, string Text, string Found);

/// <summary>
/// An end-of-game personal title. Rule: "discoveries" (objects, hidden symbols, clues and items found), "puzzles" (puzzles the
/// player helped solve), "mechanisms" (meaningful mechanism steps: a solve, a correct placement, a maze stage) or "hintless"
/// (puzzles the player helped solve with no hint revealed).
/// </summary>
public sealed record PersonalTitleContent(string Id, string Title, string Description, string Icon, string Rule);

public sealed record ZoneContent(string Id, string Name, int Order, string Icon, string EntryLine, string? Story = null);

public sealed record ItemContent(string Id, string Name, string Description, string Zone, bool SpawnedAtStart);

public sealed record RecipeContent(List<string> Inputs, string Output, string Message);

public sealed record AchievementContent(string Id, string Title, string Description);

/// <summary>
/// A clue; reading it first may reveal an item hidden in the room (e.g. a drawer that opens). With RequiresPuzzle it can be
/// read only once that puzzle is solved (the workshop scroll appears with the engraved blueprint).
/// </summary>
public sealed record ClueContent(string Id, string Zone, string Title, string Text, string? RevealsItem = null, string? RequiresPuzzle = null);

/// <summary>All score values in one place (spec Part G §18), so they can be changed without touching the puzzles.</summary>
public sealed class ScoringRules
{
    public int Clue { get; init; } = 10;
    public int Mechanism { get; init; } = 20;
    public int Placement { get; init; } = 10;
    public int Answer { get; init; } = 25;
    /// <summary>First pickup of an important item (spec 6).</summary>
    public int Pickup { get; init; } = 10;
    /// <summary>"Complex stage" events, e.g. each maze symbol reached in the right order (spec: up to 25).</summary>
    public int Stage { get; init; } = 5;
    public Dictionary<string, int> Room { get; init; } = new() { ["easy"] = 100, ["medium"] = 150, ["hard"] = 250 };
    public int HintPenalty { get; init; } = 10;
    /// <summary>First inspection of an object that hides evidence (the library's four objects).</summary>
    public int Found { get; init; } = 10;
    /// <summary>
    /// Group bonus for a puzzle solved without any hint, once per puzzle (0 = none: the default, so other scenarios are
    /// unchanged). Rooms listed in NoHintSkipZones keep their scoring exactly as it was.
    /// </summary>
    /// <summary>A secret personal task completed (personal, once per player and task).</summary>
    public int Task { get; init; }
    public int NoHint { get; init; }
    public List<string> NoHintSkipZones { get; init; } = new();
    /// <summary>A hidden symbol uncovered while inspecting an object.</summary>
    public int Symbol { get; init; } = 15;
}

/// <summary>
/// A puzzle's own points, over the scenario's general values: what solving it gives the solver, and what each correct
/// placement gives (0 = none). Absent values keep the general rules, so existing puzzles score exactly as before.
/// </summary>
public sealed record PuzzleScore(int? Solve = null, int? Placement = null);

public sealed record PersonalClue(int Index, string Title, string Text, string Visual, int Value);

public sealed record KeyEntry(string Symbol, string Letter);

public sealed class PuzzleContent
{
    public required string Id { get; init; }
    public int Order { get; init; }
    public required string Type { get; init; }
    public required string Zone { get; init; }
    public required string Title { get; init; }
    public required string Objective { get; init; }
    public required string Instructions { get; init; }
    public JsonObject PublicData { get; init; } = new();
    /// <summary>Never sent to clients.</summary>
    public required JsonObject Solution { get; init; }
    public List<PersonalClue> PersonalClues { get; init; } = new();
    /// <summary>Cipher key split into parts; each player sees only their part (never sent publicly).</summary>
    public List<List<KeyEntry>> PersonalKey { get; init; } = new();
    public required List<string> Hints { get; init; }
    public required string Success { get; init; }
    public required string Failure { get; init; }
    public string? RewardLetter { get; init; }
    public string? RewardItem { get; init; }
    /// <summary>Solving lays this item out in the room (the clue box opens on the scroll), to be picked up — not a trophy.</summary>
    public string? RevealsItem { get; init; }
    public string? UnlocksZone { get; init; }
    /// <summary>Stays locked until this puzzle (in the same room) is solved.</summary>
    public string? RequiresPuzzle { get; init; }
    /// <summary>
    /// An extra puzzle: it gives personal points, but never opens or blocks a door, the room's group points or the end
    /// of the game (the scales beside the mosaic).
    /// </summary>
    public bool Bonus { get; init; }
    public PuzzleScore? Score { get; init; }
}

/// <summary>Loads game scenarios from the content folder. Content is kept separate from code (spec §13).</summary>
public sealed class ScenarioCatalog
{
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly Dictionary<string, ScenarioContent> _scenarios;

    public ScenarioCatalog(Dictionary<string, ScenarioContent> scenarios) => _scenarios = scenarios;

    public static ScenarioCatalog LoadFrom(string folder)
    {
        var dict = new Dictionary<string, ScenarioContent>();
        foreach (var file in Directory.GetFiles(folder, "*.json"))
        {
            var scenario = JsonSerializer.Deserialize<ScenarioContent>(File.ReadAllText(file), JsonOptions)
                ?? throw new InvalidDataException($"Empty scenario file {file}");
            Validate(scenario);
            dict[scenario.Id] = scenario;
        }
        return new ScenarioCatalog(dict);
    }

    public static ScenarioCatalog LoadDefault() =>
        LoadFrom(Path.Combine(AppContext.BaseDirectory, "Content", "scenarios"));

    public IReadOnlyCollection<ScenarioContent> All => _scenarios.Values;

    public ScenarioContent? Find(string id) => _scenarios.GetValueOrDefault(id);

    public ScenarioContent Get(string id) => Find(id) ?? throw new KeyNotFoundException($"Scenario {id} not found");

    private static void Validate(ScenarioContent s)
    {
        foreach (var c in s.Clues)
            if (s.Zones.All(z => z.Id != c.Zone)) throw new InvalidDataException($"clue {c.Id}: unknown zone {c.Zone}");
        foreach (var c in s.Clues.Where(c => c.RequiresPuzzle != null))
            if (s.Puzzles.All(p => p.Id != c.RequiresPuzzle)) throw new InvalidDataException($"clue {c.Id}: unknown puzzle {c.RequiresPuzzle}");
        if (s.Scoring != null)
            foreach (var z in s.Zones)
                if (!s.ZoneDifficulty.TryGetValue(z.Id, out var d) || !s.Scoring.Room.ContainsKey(d))
                    throw new InvalidDataException($"{s.Id}: zone {z.Id} has no scored difficulty");
        if (s.Puzzles.Count == 0) throw new InvalidDataException($"{s.Id}: no puzzles");
        // a game whose rooms are left through doors (the free game, 2.0): only a door opens a room; every room before the
        // last has exactly one, it opens the next room, and it waits for the room's puzzles (the engine checks that too)
        if (s.Puzzles.Any(p => p.Type == "exitdoor"))
        {
            foreach (var p in s.Puzzles.Where(p => p.UnlocksZone != null && p.Type != "exitdoor"))
                throw new InvalidDataException($"{p.Id}: only the room's door may open the next room");
            var zones = s.Zones.OrderBy(z => z.Order).ToList();
            for (var i = 0; i < zones.Count; i++)
            {
                // every room has one door: to the next room, or (the last room) the exit gate, which opens no room
                var last = i == zones.Count - 1;
                var doors = s.Puzzles.Where(p => p.Type == "exitdoor" && p.Zone == zones[i].Id).ToList();
                if (last && doors.Count == 0) continue;
                if (doors.Count != 1 || doors[0].UnlocksZone != (last ? null : zones[i + 1].Id))
                    throw new InvalidDataException($"{zones[i].Id}: needs exactly one door, " + (last ? "the exit gate" : $"to {zones[i + 1].Id}"));
                var door = doors[0];
                var rest = s.Puzzles.Where(p => p.Zone == door.Zone && p.Id != door.Id && !p.Bonus).ToList();
                if (rest.Any(p => p.Order > door.Order) || door.RequiresPuzzle == null || rest.All(p => p.Id != door.RequiresPuzzle))
                    throw new InvalidDataException($"{door.Id}: the door must come after every puzzle of its room");
                if (door.PublicData["needsItem"]?.GetValue<string>() is { } key && s.Item(key) == null)
                    throw new InvalidDataException($"{door.Id}: unknown key {key}");
            }
        }
        foreach (var t in s.PersonalTasks)
            if (s.Zones.All(z => z.Id != t.Zone)) throw new InvalidDataException($"task {t.Id}: unknown zone {t.Zone}");
        if (s.PersonalTasks.Select(t => t.Id).Distinct().Count() != s.PersonalTasks.Count) throw new InvalidDataException($"{s.Id}: duplicate task id");
        foreach (var t in s.Titles)
            if (!Game.GameEngine.TitleRules.Contains(t.Rule)) throw new InvalidDataException($"title {t.Id}: unknown rule {t.Rule}");
        foreach (var p in s.Puzzles)
        {
            if (p.Hints.Count is < 1 or > 3) throw new InvalidDataException($"{p.Id}: expected 1–3 hint levels");
            if (p.RequiresPuzzle != null && s.Puzzles.All(x => x.Id != p.RequiresPuzzle)) throw new InvalidDataException($"{p.Id}: unknown required puzzle");
            if (s.Zones.All(z => z.Id != p.Zone)) throw new InvalidDataException($"{p.Id}: unknown zone {p.Zone}");
            if (p.RewardItem != null && s.Item(p.RewardItem) == null) throw new InvalidDataException($"{p.Id}: unknown item");
            if (p.RevealsItem != null && s.Item(p.RevealsItem) == null) throw new InvalidDataException($"{p.Id}: unknown revealed item");
            if (p.Type == "inspect")
            {
                if (p.PublicData["targets"] is not System.Text.Json.Nodes.JsonArray { Count: > 0 } targets)
                    throw new InvalidDataException($"{p.Id}: an inspection needs targets");
                foreach (var t in targets)
                    if (t!["item"]?.GetValue<string>() is { } item && s.Item(item) == null) throw new InvalidDataException($"{p.Id}: unknown item {item}");
            }
            if (p.Type == "pendulum")
            {
                if (p.PublicData["rounds"] is not System.Text.Json.Nodes.JsonArray { Count: > 0 } rounds)
                    throw new InvalidDataException($"{p.Id}: a pendulum needs rounds");
                foreach (var r in rounds)
                {
                    var kind = r!["kind"]?.GetValue<string>() ?? "steady";
                    if (kind is not ("steady" or "varying" or "pause")) throw new InvalidDataException($"{p.Id}: unknown swing {kind}");
                    if ((r["period"]?.GetValue<double>() ?? 0) <= 0 || (r["amplitude"]?.GetValue<double>() ?? 0) <= 0)
                        throw new InvalidDataException($"{p.Id}: every round needs a period and an amplitude");
                    // a larger drift would make the swing run backwards for a moment
                    if (kind == "varying" && (r["vary"]?.GetValue<double>() ?? 0.9) >= 2.7) throw new InvalidDataException($"{p.Id}: vary must stay under 2.7");
                }
                var window = p.PublicData["window"]?.GetValue<double>() ?? 7;
                if (rounds.Any(r => window >= r!["amplitude"]!.GetValue<double>())) throw new InvalidDataException($"{p.Id}: the target zone is wider than the swing");
            }
            if (p.Type == "runechain")
            {
                var symbols = p.PublicData["symbols"]?.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToHashSet() ?? [];
                var stages = p.Solution["stages"]?.AsArray() ?? [];
                var shapes = p.PublicData["stages"]?.AsArray() ?? [];
                if (stages.Count == 0 || stages.Count != shapes.Count) throw new InvalidDataException($"{p.Id}: every stage needs its sequence and its public shape");
                for (var i = 0; i < stages.Count; i++)
                {
                    var seq = stages[i]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
                    if (seq.Count != shapes[i]!["length"]?.GetValue<int>() || seq.Any(x => !symbols.Contains(x)))
                        throw new InvalidDataException($"{p.Id}: stage {i + 1} must be {shapes[i]!["length"]} known symbols");
                    if (shapes[i]!["dark"]?.GetValue<int>() is { } dark && (dark < 0 || dark >= seq.Count || p.PersonalClues.Count == 0))
                        throw new InvalidDataException($"{p.Id}: a light in the dark needs a place in the stage and a private clue that tells it");
                }
            }
            if (p.Type == "assembly")
            {
                var pieces = p.PublicData["pieces"]?.AsArray().Select(n => n!["id"]!.GetValue<string>()).OrderBy(x => x).ToList() ?? [];
                var start = p.PublicData["start"]?["order"]?.AsArray().Select(n => n!.GetValue<string>()).OrderBy(x => x).ToList() ?? [];
                var goal = p.Solution["order"]?.AsArray().Select(n => n!.GetValue<string>()).OrderBy(x => x).ToList() ?? [];
                var turns = p.PublicData["start"]?["turns"]?.AsArray().Count ?? -1;
                if (pieces.Count == 0 || !pieces.SequenceEqual(start) || !pieces.SequenceEqual(goal) || turns != pieces.Count)
                    throw new InvalidDataException($"{p.Id}: the start and the solution must place every piece once, with a turn for each");
            }
            if (p.Bonus && (p.UnlocksZone != null || s.Puzzles.Any(x => x.RequiresPuzzle == p.Id)))
                throw new InvalidDataException($"{p.Id}: a bonus puzzle may not open a room or be required by another puzzle");
            if (p.PersonalKey.Count > 0 && p.PublicData["message"] is System.Text.Json.Nodes.JsonArray msg)
            {
                // every symbol of the message must be in exactly one part, and no single part may decode it alone
                foreach (var sym in msg.Select(n => n!.GetValue<string>()))
                    if (p.PersonalKey.Count(part => part.Any(k => k.Symbol == sym)) != 1)
                        throw new InvalidDataException($"{p.Id}: symbol {sym} must appear in exactly one key part");
                if (p.PersonalKey.Any(part => msg.All(n => part.Any(k => k.Symbol == n!.GetValue<string>()))))
                    throw new InvalidDataException($"{p.Id}: one key part decodes the message alone — no cooperation needed");
            }
        }
    }
}
