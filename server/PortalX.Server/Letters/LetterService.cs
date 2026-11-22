using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Letters;

/// <summary>
/// Seals letter text with AES-256-GCM (the same scheme as the Gmail token). The key comes from LETTER_ENCRYPTION_KEY;
/// without it, from a random key kept once in AppSecrets (so letters always survive restarts). The letter, room and sender
/// ids are bound in as associated data, so sealed text cannot be moved to another letter.
/// </summary>
public sealed class LetterProtector(string? configuredKey)
{
    public const string SecretName = "letters-key";
    public bool Configured => configuredKey != null;

    public static LetterProtector FromConfig(IConfiguration c) =>
        new(string.IsNullOrWhiteSpace(c["LETTER_ENCRYPTION_KEY"]) ? null : c["LETTER_ENCRYPTION_KEY"]!.Trim());

    private static byte[] Key(string secret) => SHA256.HashData(Encoding.UTF8.GetBytes("portalx-letter:" + secret));

    private static byte[] Bound(PersonalLetter l) => Encoding.UTF8.GetBytes($"{l.Id:N}:{l.RoomId:N}:{l.SenderPlayerId:N}");

    public static string Seal(string secret, PersonalLetter letter, string text)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plain = Encoding.UTF8.GetBytes(text);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using var gcm = new AesGcm(Key(secret), 16);
        gcm.Encrypt(nonce, plain, cipher, tag, Bound(letter));
        return "v1." + Convert.ToBase64String(nonce.Concat(tag).Concat(cipher).ToArray());
    }

    /// <summary>The text, or null when the data was changed, belongs to another letter or was sealed with another key.</summary>
    public static string? Open(string secret, PersonalLetter letter)
    {
        try
        {
            if (!letter.BodySealed.StartsWith("v1.")) return null;
            var all = Convert.FromBase64String(letter.BodySealed[3..]);
            var cipher = all[28..];
            var plain = new byte[cipher.Length];
            using var gcm = new AesGcm(Key(secret), 16);
            gcm.Decrypt(all[..12], cipher, all[12..28], plain, Bound(letter));
            return Encoding.UTF8.GetString(plain);
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or ArgumentException)
        {
            return null;
        }
    }

    public async Task<string> SecretAsync(PortalDbContext db)
    {
        if (configuredKey != null) return configuredKey;
        var row = await db.AppSecrets.AsNoTracking().FirstOrDefaultAsync(s => s.Name == SecretName);
        if (row != null) return row.Value;
        db.AppSecrets.Add(new AppSecret { Name = SecretName, Value = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)), CreatedAt = DateTime.UtcNow });
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); }   // another server made it first
        return (await db.AppSecrets.AsNoTracking().FirstAsync(s => s.Name == SecretName)).Value;
    }
}

public sealed record LetterEnvelope(string Id, string From, DateTime CreatedAt, DateTime? OpenedAt, int Round);
public sealed record LetterView(string Id, string From, string Text, DateTime CreatedAt, DateTime? OpenedAt, int Round);
public sealed record SentView(string Id, bool HasRecipient, DateTime CreatedAt, DateTime? DeliveredAt, DateTime? OpenedAt);
public sealed record SendOutcome(bool Ok, string Code, string Message, PersonalLetter? Letter = null, string? SenderName = null, bool Duplicate = false);
public sealed record LettersView(IReadOnlyList<LetterView> Inbox, SentView? Sent, LetterView? Kept, bool Solo);

/// <summary>
/// The private letters of "הצופן הזוגי". Who writes and who reads is decided here from the signed-in seat only: the
/// recipient is never taken from the client. Letter text is never logged, never part of the shared game state or its
/// event log, and is returned only to its recipient (or to the solo writer who kept it).
/// </summary>
public sealed class LetterService(PortalDbContext db, ScenarioCatalog catalog, LetterProtector protector)
{
    public const int MaxLength = 4000;

    private static bool Active(PlayerSession p) => !p.IsRemoved && p.SeatReleasedAt == null;

    /// <summary>Trims, keeps line breaks and tabs, drops other control characters, and normalizes line endings.</summary>
    public static string Clean(string? text)
    {
        var s = (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n');
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s)
            if (ch is '\n' or '\t' || !char.IsControl(ch)) sb.Append(ch);
        return sb.ToString().Trim();
    }

    private async Task<(GameRoom? Room, PlayerSession? Me, string? Problem)> LoadAsync(Guid roomId, Guid playerId)
    {
        var room = await db.Rooms.AsNoTracking().Include(r => r.Players).FirstOrDefaultAsync(r => r.Id == roomId);
        if (room == null) return (null, null, "החדר לא נמצא.");
        if (catalog.Find(room.ScenarioId)?.PersonalLetters != true) return (null, null, "במשחק הזה אין מכתבים.");
        var me = room.Players.FirstOrDefault(p => p.Id == playerId && Active(p));
        return me == null ? (null, null, "אינכם רשומים במשחק הזה.") : (room, me, null);
    }

    public async Task<SendOutcome> SendAsync(Guid roomId, Guid playerId, string? clientLetterId, string? body, bool keepAlone)
    {
        var (room, me, problem) = await LoadAsync(roomId, playerId);
        if (problem != null) return new(false, "not-allowed", problem);
        if (room!.Phase != RoomPhase.Playing) return new(false, "not-playing", "אפשר לשלוח מכתב רק במהלך המשחק.");
        var id = (clientLetterId ?? "").Trim();
        if (id.Length is < 8 or > 64) return new(false, "bad-id", "המכתב לא נשלח בצורה תקינה. נסו שוב.");
        var text = Clean(body);
        if (text.Length == 0) return new(false, "empty", "המכתב ריק. כתבו כמה מילים לפני השליחה.");
        if (text.Length > MaxLength) return new(false, "too-long", $"המכתב ארוך מדי — עד {MaxLength} תווים.");

        // the other player of this game, decided here; alone, the letter is kept only when the player chose to keep it
        var others = room.Players.Where(p => p.Id != playerId && Active(p)).ToList();
        if (others.Count > 1) return new(false, "not-allowed", "מכתב אישי נשלח רק במשחק של שני משתתפים.");
        var recipient = others.FirstOrDefault();
        if (recipient == null && !keepAlone) return new(false, "no-partner", "אין עדיין משתתף נוסף במשחק.");

        var existing = await db.PersonalLetters.AsNoTracking()
            .FirstOrDefaultAsync(l => l.RoomId == roomId && l.Round == room.Round && l.SenderPlayerId == playerId);
        if (existing != null)
            return existing.ClientLetterId == id
                ? new(true, "duplicate", "המכתב כבר נשלח.", existing, me!.Nickname, true)
                : new(false, "already-sent", "כבר שלחתם מכתב בסיבוב הזה.");

        var letter = new PersonalLetter
        {
            Id = Guid.NewGuid(), RoomId = roomId, Round = room.Round, SenderPlayerId = playerId,
            RecipientPlayerId = recipient?.Id, ClientLetterId = id, CreatedAt = DateTime.UtcNow,
        };
        letter.BodySealed = LetterProtector.Seal(await protector.SecretAsync(db), letter, text);
        db.PersonalLetters.Add(letter);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException)
        {
            // two clicks at once: the first one saved it
            db.ChangeTracker.Clear();
            var won = await db.PersonalLetters.AsNoTracking()
                .FirstOrDefaultAsync(l => l.RoomId == roomId && l.Round == room.Round && l.SenderPlayerId == playerId);
            if (won?.ClientLetterId == id) return new(true, "duplicate", "המכתב כבר נשלח.", won, me!.Nickname, true);
            return new(false, "already-sent", "כבר שלחתם מכתב בסיבוב הזה.");
        }
        return new(true, "ok", recipient == null ? "המכתב נשמר." : "המכתב נשלח.", letter, me!.Nickname);
    }

    /// <summary>
    /// What this player may read: every letter sent to them (all rounds), the status of the one they sent this round, and
    /// in a solo game the letter they kept. Letters seen here for the first time are marked delivered.
    /// </summary>
    public async Task<LettersView?> ViewAsync(Guid roomId, Guid playerId)
    {
        var (room, me, problem) = await LoadAsync(roomId, playerId);
        if (problem != null) return null;
        var secret = await protector.SecretAsync(db);
        var names = room!.Players.ToDictionary(p => p.Id, p => p.Nickname);
        var inbox = await db.PersonalLetters.Where(l => l.RoomId == roomId && l.RecipientPlayerId == playerId).OrderBy(l => l.CreatedAt).ToListAsync();
        var now = DateTime.UtcNow;
        foreach (var l in inbox.Where(l => l.DeliveredAt == null)) l.DeliveredAt = now;
        if (db.ChangeTracker.HasChanges()) await db.SaveChangesAsync();
        var view = inbox.Select(l => new LetterView(l.Id.ToString("N"), names.GetValueOrDefault(l.SenderPlayerId, ""),
            LetterProtector.Open(secret, l) ?? "", l.CreatedAt, l.OpenedAt, l.Round)).ToList();
        var mine = await db.PersonalLetters.AsNoTracking()
            .FirstOrDefaultAsync(l => l.RoomId == roomId && l.Round == room.Round && l.SenderPlayerId == playerId);
        var solo = room.Players.Count(Active) == 1;
        var sent = mine == null ? null : new SentView(mine.Id.ToString("N"), mine.RecipientPlayerId != null, mine.CreatedAt, mine.DeliveredAt, mine.OpenedAt);
        LetterView? kept = mine is { RecipientPlayerId: null }
            ? new(mine.Id.ToString("N"), me!.Nickname, LetterProtector.Open(secret, mine) ?? "", mine.CreatedAt, mine.OpenedAt, mine.Round)
            : null;
        return new LettersView(view, sent, kept, solo);
    }

    /// <summary>Marks a letter delivered (its envelope reached the recipient's screen live). Only the recipient can.</summary>
    public async Task MarkDeliveredAsync(Guid letterId, Guid recipientId)
    {
        await db.PersonalLetters.Where(l => l.Id == letterId && l.RecipientPlayerId == recipientId && l.DeliveredAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(l => l.DeliveredAt, DateTime.UtcNow));
    }

    /// <summary>Opens a letter (once; again is fine). Returns the writer to tell, or null when it is not this player's letter.</summary>
    public async Task<(Guid Sender, DateTime OpenedAt)?> OpenAsync(Guid roomId, Guid playerId, string letterId)
    {
        if (!Guid.TryParse(letterId, out var id)) return null;
        var letter = await db.PersonalLetters.FirstOrDefaultAsync(l => l.Id == id && l.RoomId == roomId && l.RecipientPlayerId == playerId);
        if (letter == null) return null;
        letter.DeliveredAt ??= DateTime.UtcNow;
        letter.OpenedAt ??= DateTime.UtcNow;
        await db.SaveChangesAsync();
        return (letter.SenderPlayerId, letter.OpenedAt.Value);
    }
}
