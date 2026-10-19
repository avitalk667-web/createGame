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
    public int MinPlayers { get; init; } = 4;
    public int MaxPlayers { get; init; } = 8;
    public required string FinalWord { get; init; }
    public required List<ZoneContent> Zones { get; init; }
    public required List<ItemContent> Items { get; init; }
    public required List<RecipeContent> Recipes { get; init; }
    public required List<PuzzleContent> Puzzles { get; init; }
    public required List<AchievementContent> Achievements { get; init; }

    public PuzzleContent Puzzle(string id) =>
        Puzzles.FirstOrDefault(p => p.Id == id) ?? throw new KeyNotFoundException($"Puzzle {id} not found");

    public ItemContent? Item(string id) => Items.FirstOrDefault(i => i.Id == id);
}

public sealed record ZoneContent(string Id, string Name, int Order, string Icon, string EntryLine);

public sealed record ItemContent(string Id, string Name, string Description, string Zone, bool SpawnedAtStart);

public sealed record RecipeContent(List<string> Inputs, string Output, string Message);

public sealed record AchievementContent(string Id, string Title, string Description);

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
    public string? UnlocksZone { get; init; }
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
        if (s.Puzzles.Count == 0) throw new InvalidDataException($"{s.Id}: no puzzles");
        foreach (var p in s.Puzzles)
        {
            if (p.Hints.Count != 3) throw new InvalidDataException($"{p.Id}: expected 3 hint levels");
            if (s.Zones.All(z => z.Id != p.Zone)) throw new InvalidDataException($"{p.Id}: unknown zone {p.Zone}");
            if (p.RewardItem != null && s.Item(p.RewardItem) == null) throw new InvalidDataException($"{p.Id}: unknown item");
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
