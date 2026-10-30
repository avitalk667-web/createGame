namespace PortalX.Server.Domain;

// Data entities per spec §12.

public class GameScenario
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Duration { get; set; } = "";
    public string Difficulty { get; set; } = "";
    public string PuzzleIds { get; set; } = "[]";
    public DateTime UpdatedAt { get; set; }
}

public class PuzzleDefinition
{
    public string Id { get; set; } = "";
    public string ScenarioId { get; set; } = "";
    public int Order { get; set; }
    public string Type { get; set; } = "";
    public string Zone { get; set; } = "";
    public string Title { get; set; } = "";
    public string Instructions { get; set; } = "";
    public string PublicDataJson { get; set; } = "{}";
    public string SolutionJson { get; set; } = "{}";
    public string HintsJson { get; set; } = "[]";
    public string SuccessMessage { get; set; } = "";
    public string FailureMessage { get; set; } = "";
}

public enum RoomPhase { Lobby = 0, Intro = 1, Playing = 2, Completed = 3 }

public class GameRoom
{
    public Guid Id { get; set; }
    public string Code { get; set; } = "";
    public string ScenarioId { get; set; } = "";
    public RoomPhase Phase { get; set; }
    public Guid? HostPlayerId { get; set; }
    /// <summary>SHA-256 of the one-time host claim token handed to the room creator.</summary>
    public string HostClaimHash { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? IntroStartedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public int Round { get; set; }
    /// <summary>JSON of <see cref="WorldState"/>: inventory, world items, letters, contributions.</summary>
    public string WorldJson { get; set; } = "{}";
    public DateTime UpdatedAt { get; set; }
    /// <summary>Catalog product this game was opened for (null for rooms created before purchases existed).</summary>
    public string? ProductId { get; set; }
    /// <summary>The entitlement that paid for this room; at most one room per entitlement.</summary>
    public Guid? EntitlementId { get; set; }
    /// <summary>"purchase", "admin-free" or "legacy" (created before purchases existed).</summary>
    public string AccessSource { get; set; } = "legacy";
    /// <summary>Participant limit of this game, host included, fixed when it was opened (see GameOptions.MaxPlayers).</summary>
    public int MaxPlayers { get; set; } = 4;

    public List<PlayerSession> Players { get; set; } = new();
    public List<PuzzleState> Puzzles { get; set; } = new();
}

public class PlayerSession
{
    public Guid Id { get; set; }
    public Guid RoomId { get; set; }
    public string Nickname { get; set; } = "";
    public string CharacterId { get; set; } = "";
    public string AppearanceJson { get; set; } = "{}";
    public string TokenHash { get; set; } = "";
    public int Seat { get; set; }
    public bool IsReady { get; set; }
    public bool IsConnected { get; set; }
    public string? ConnectionId { get; set; }
    public DateTime JoinedAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    /// <summary>Left the lobby before the game started (the record is not used anymore).</summary>
    public bool IsRemoved { get; set; }
    /// <summary>When the connection was lost; the seat stays reserved for GameOptions.SeatHoldMinutes after it.</summary>
    public DateTime? DisconnectedAt { get; set; }
    /// <summary>The seat was given up (explicit leave, freed by the host, or taken after the hold expired).
    /// The record, score and history stay; the same player may come back if a seat is free.</summary>
    public DateTime? SeatReleasedAt { get; set; }
}

public enum PuzzleStatus { Locked = 0, Active = 1, Solved = 2 }

public class PuzzleState
{
    public Guid RoomId { get; set; }
    public string PuzzleId { get; set; } = "";
    public PuzzleStatus Status { get; set; }
    public int Attempts { get; set; }
    public int WrongStreak { get; set; }
    public DateTime? CooldownUntil { get; set; }
    public int HintsRevealed { get; set; }
    public DateTime? SolvedAt { get; set; }
    public Guid? SolvedByPlayerId { get; set; }
}

public class GameEvent
{
    public long Id { get; set; }
    public Guid RoomId { get; set; }
    public Guid? PlayerId { get; set; }
    public string Type { get; set; } = "";
    public string? ClientActionId { get; set; }
    public string PayloadJson { get; set; } = "{}";
    public string ResultJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; }
}

public class GameResult
{
    public Guid Id { get; set; }
    public Guid RoomId { get; set; }
    public string ScenarioId { get; set; } = "";
    public int Round { get; set; }
    public int DurationSeconds { get; set; }
    public int PlayersCount { get; set; }
    public int HintsUsed { get; set; }
    public int WrongAttempts { get; set; }
    public int PuzzlesSolved { get; set; }
    public int PuzzlesTotal { get; set; }
    public string AchievementsJson { get; set; } = "[]";
    public string CompletionType { get; set; } = "success";
    public DateTime CreatedAt { get; set; }
}

/// <summary>Group-wide world state stored as JSON on the room.</summary>
public class WorldState
{
    public List<string> Inventory { get; set; } = new();
    public List<string> WorldItems { get; set; } = new();
    public List<string> PlacedItems { get; set; } = new();
    public List<GoldenLetter> Letters { get; set; } = new();
    public Dictionary<string, int> Contributions { get; set; } = new();
    /// <summary>The room the whole group is in, and since when (moves only when the group continues).</summary>
    public string? CurrentZone { get; set; }
    public DateTime? CurrentZoneSince { get; set; }
    /// <summary>A room that was just opened and waits for the group to press "Continue".</summary>
    public string? PendingZone { get; set; }
    public DateTime? PendingSince { get; set; }
    /// <summary>Shared state of mechanism puzzles (slots, maze, mosaic), by puzzle id.</summary>
    public Dictionary<string, MechanismState> Mechanisms { get; set; } = new();
    /// <summary>Discovered clue ids → the player who found each first.</summary>
    public Dictionary<string, string> Clues { get; set; } = new();
    /// <summary>Scores of the current round (only for scenarios with scoring).</summary>
    public ScoreBoard? Score { get; set; }
    /// <summary>
    /// The admin's questions this round uses, by puzzle — copied when the game started, so later edits never change it.
    /// The answers stay on the server.
    /// </summary>
    public Dictionary<string, QuestionUse> Questions { get; set; } = new();
}

/// <summary>One admin question as a game uses it (a copy of a GameQuestion version).</summary>
public sealed class QuestionUse
{
    public Guid QuestionId { get; set; }
    public int Version { get; set; }
    /// <summary>The public field it replaces ("question" or "riddle").</summary>
    public string Field { get; set; } = "question";
    public string Question { get; set; } = "";
    public string Answer { get; set; } = "";
    public List<string> Accept { get; set; } = new();
    public int? Points { get; set; }
    /// <summary>The answer buttons of a multiple-choice question, with the right one in place of the built-in answer.</summary>
    public List<string>? Options { get; set; }
}

public sealed class MechanismState
{
    /// <summary>Slots: slot id → item id, and slot id → player who placed it.</summary>
    public Dictionary<string, string> Slots { get; set; } = new();
    public Dictionary<string, string> SlotBy { get; set; } = new();
    /// <summary>Slots with an activate button: all parts are in the right places.</summary>
    public bool Ready { get; set; }
    /// <summary>Values revealed once every slot is filled (e.g. digits on the backs of the dreidels), by slot id.</summary>
    public Dictionary<string, string> Backs { get; set; } = new();
    /// <summary>Maze: key position [row, col], lever states, symbols passed in order.</summary>
    public List<int> Key { get; set; } = new();
    public List<bool> Levers { get; set; } = new();
    public int Progress { get; set; }
    /// <summary>Mosaic: quarter turns of each stone.</summary>
    public List<int> Rotations { get; set; } = new();
    /// <summary>Scales: where the beam leans (-1 left pan heavier, 0 level, 1 right pan heavier).</summary>
    public int Tilt { get; set; }
    /// <summary>Something the solved mechanism reveals, e.g. the code in the maze's collection box.</summary>
    public string? Revealed { get; set; }
    /// <summary>
    /// "Check the arrangement" (the pedestals of the hall): for each checked place, whether its item is right. Set only by
    /// the server's check and cleared when that place changes; a right item stays where it is.
    /// </summary>
    public Dictionary<string, bool> Verdict { get; set; } = new();
}

/// <summary>Personal and group score of a round. The server is the only authority (spec Part G §19).</summary>
public sealed class ScoreBoard
{
    public Dictionary<string, int> Personal { get; set; } = new();
    /// <summary>Puzzles, mechanisms and answers each player completed (contributions and tie-break).</summary>
    public Dictionary<string, int> Solved { get; set; } = new();
    public Dictionary<string, int> Rooms { get; set; } = new();
    public int Group { get; set; }
    /// <summary>Every award given this round; its key makes each award happen at most once.</summary>
    public List<ScoreEntry> Log { get; set; } = new();
}

public sealed record ScoreEntry(string Key, string? PlayerId, string Kind, string Type, int Points, string Reason, string? Zone, string? PuzzleId, DateTime At);

/// <summary>Every score award, stored once (unique per room, round and key) — spec Part H PlayerScoreEvents.</summary>
public class PlayerScoreEvent
{
    public long Id { get; set; }
    public Guid RoomId { get; set; }
    public int Round { get; set; }
    /// <summary>Null for group points.</summary>
    public Guid? PlayerId { get; set; }
    public string Kind { get; set; } = "personal";
    public string Type { get; set; } = "";
    public int Points { get; set; }
    public string? Zone { get; set; }
    public string? PuzzleId { get; set; }
    public string Key { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

public record GoldenLetter(string Letter, string Zone);

public enum ProductStatus { Draft = 0, Published = 1, Hidden = 2 }

/// <summary>A purchasable game in the shared catalog. Prices live here only, never in the client.</summary>
public class Product
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Tagline { get; set; } = "";
    public string Description { get; set; } = "";
    /// <summary>Price in ILS for one group game; null = not set yet (cannot be sold).</summary>
    public decimal? PriceIls { get; set; }
    public string Currency { get; set; } = "ILS";
    public string CoverImage { get; set; } = "";
    /// <summary>JSON array of { src, caption }.</summary>
    public string GalleryJson { get; set; } = "[]";
    /// <summary>JSON array of short feature chips.</summary>
    public string FeaturesJson { get; set; } = "[]";
    /// <summary>JSON array of "what's included" lines.</summary>
    public string IncludedJson { get; set; } = "[]";
    public ProductStatus Status { get; set; }
    public int MinPlayers { get; set; } = 1;
    public int MaxPlayers { get; set; } = 4;
    /// <summary>A free trial game: started without payment, never sold, never revenue.</summary>
    public bool IsFree { get; set; }
    public string GameType { get; set; } = "escape-room-3d";
    /// <summary>Scenario that runs when the game is played; null or unknown = not playable yet.</summary>
    public string? ScenarioId { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public enum OrderStatus { Pending = 0, Paid = 1, Failed = 2, Cancelled = 3, Refunded = 4 }

/// <summary>
/// A guest purchase of one group game. No customer account: the buyer proves ownership with a secret
/// order key (only its hash is stored). The price is copied from the catalog when the order is created.
/// </summary>
public class Order
{
    public Guid Id { get; set; }
    /// <summary>Short public order number shown to the buyer and the admin.</summary>
    public long Number { get; set; }
    public string ProductId { get; set; } = "";
    public string ProductName { get; set; } = "";
    public decimal PriceSnapshot { get; set; }
    public string Currency { get; set; } = "ILS";
    public OrderStatus Status { get; set; }
    public string Provider { get; set; } = "";
    /// <summary>True when paid through a test/sandbox provider: never revenue, never unlocks production games.</summary>
    public bool IsTest { get; set; }
    public string? ProviderSessionId { get; set; }
    public string? ProviderTransactionId { get; set; }
    /// <summary>Optional, only for the receipt / support. Never a login.</summary>
    public string? Email { get; set; }
    public string AccessKeyHash { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? PaidAt { get; set; }
    public DateTime? FailedAt { get; set; }
    public DateTime? RefundedAt { get; set; }
    public decimal? RefundedAmount { get; set; }
    /// <summary>Catalog price before a coupon (PriceSnapshot is what is charged). Null for orders created before coupons.</summary>
    public decimal? OriginalPrice { get; set; }
    public decimal DiscountAmount { get; set; }
    public string? CouponCode { get; set; }
    public Guid? CouponId { get; set; }
    /// <summary>
    /// The personal link this purchase came through: copied on the server from the visit's referral session when the
    /// checkout started (never from the browser or the payment provider's return). At most one per order.
    /// </summary>
    public Guid? ReferralLinkId { get; set; }
    public DateTime? ReferralAttributedAt { get; set; }
    /// <summary>Why the order does not count for its link although it came through it (e.g. "self-purchase"); null = counts.</summary>
    public string? ReferralExclusion { get; set; }
    /// <summary>Optimistic concurrency (PostgreSQL xmin).</summary>
    public uint Version { get; set; }
}

/// <summary>Every payment notification received, verified or not; the unique (Provider, ProviderEventId) blocks replays.</summary>
public class PaymentEvent
{
    public long Id { get; set; }
    public string Provider { get; set; } = "";
    public string ProviderEventId { get; set; } = "";
    public Guid? OrderId { get; set; }
    public string Type { get; set; } = "";
    public decimal? Amount { get; set; }
    public string? Currency { get; set; }
    public string? ProviderTransactionId { get; set; }
    public bool IsTest { get; set; }
    /// <summary>"applied", "ignored:..." or "rejected:...".</summary>
    public string Result { get; set; } = "";
    public DateTime ReceivedAt { get; set; }
}

/// <summary>Where a right to play came from. TestCheckout is the demo mode: no payment, never revenue, always IsTest.</summary>
public enum EntitlementSource { Purchase = 0, AdminFree = 1, TestCheckout = 2 }

/// <summary>The right to open group games of one product, created only after a verified payment (or by the admin).</summary>
public class Entitlement
{
    public Guid Id { get; set; }
    public string ProductId { get; set; } = "";
    public Guid? OrderId { get; set; }
    public EntitlementSource Source { get; set; }
    public int SessionsAllowed { get; set; } = 1;
    public int SessionsUsed { get; set; }
    public bool IsTest { get; set; }
    public bool Revoked { get; set; }
    public DateTime? RevokedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public uint Version { get; set; }
}

/// <summary>Important admin actions (spec §16): free games, product/price changes, access changes, logins.</summary>
public class AdminAuditLog
{
    public long Id { get; set; }
    public string AdminName { get; set; } = "";
    public string Action { get; set; } = "";
    public string? TargetType { get; set; }
    public string? TargetId { get; set; }
    /// <summary>Non-sensitive details only (never passwords or payment data).</summary>
    public string DetailsJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// A question added by the admin to the home page FAQ. The built-in questions ship with the site
/// (Content/faq.he.json) and are never stored here, so they cannot be removed by editing these rows.
/// </summary>
public class FaqEntry
{
    public Guid Id { get; set; }
    public string Question { get; set; } = "";
    public string Answer { get; set; } = "";
    public int SortOrder { get; set; }
    public bool Published { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// A question of a game that the admin manages (not the site's FAQ): it replaces the built-in question and answer of one
/// answer puzzle ("slot") in new games. Several may wait for the same puzzle; the first active one by order is used.
/// A game keeps the version it started with, so an edit never changes a game in progress or one that ended.
/// </summary>
public class GameQuestion
{
    public Guid Id { get; set; }
    public string ScenarioId { get; set; } = "";
    public string PuzzleId { get; set; } = "";
    public string Zone { get; set; } = "";
    public string Question { get; set; } = "";
    /// <summary>Checked only on the server; never sent to players.</summary>
    public string Answer { get; set; } = "";
    /// <summary>Other accepted answers, a JSON array of strings.</summary>
    public string AcceptJson { get; set; } = "[]";
    public string Category { get; set; } = "";
    public string Difficulty { get; set; } = "";
    /// <summary>Personal points for the right answer; null = the game's usual value.</summary>
    public int? Points { get; set; }
    public int SortOrder { get; set; }
    public bool Active { get; set; }
    /// <summary>Goes up with every saved change; a game records the version it used.</summary>
    public int Version { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public string UpdatedBy { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}

/// <summary>The question as it was before and after every change, with who changed it and when.</summary>
public class GameQuestionRevision
{
    public long Id { get; set; }
    public Guid QuestionId { get; set; }
    public int Version { get; set; }
    /// <summary>"created" or "updated".</summary>
    public string Action { get; set; } = "";
    public string? BeforeJson { get; set; }
    public string AfterJson { get; set; } = "";
    public string Admin { get; set; } = "";
    public DateTime At { get; set; }
}

public enum CouponKind { Percent = 0, Fixed = 1 }

/// <summary>A discount code for chosen products. The price after the discount is always computed by the server.</summary>
public class Coupon
{
    public Guid Id { get; set; }
    /// <summary>Upper-case, unique.</summary>
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Note { get; set; }
    public CouponKind Kind { get; set; }
    /// <summary>Percent (1–99) or a fixed amount in ILS.</summary>
    public decimal Value { get; set; }
    public DateTime? StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    /// <summary>Total successful uses allowed; null = unlimited.</summary>
    public int? MaxRedemptions { get; set; }
    public bool Active { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<CouponProduct> Products { get; set; } = new();
}

/// <summary>The products a coupon applies to (one or more, chosen explicitly).</summary>
public class CouponProduct
{
    public Guid CouponId { get; set; }
    public string ProductId { get; set; } = "";
}

public enum RedemptionStatus { Reserved = 0, Redeemed = 1, Released = 2, Refunded = 3 }

/// <summary>
/// One use of a coupon, tied to one order. Reserved while the order waits for payment (so two buyers cannot both take
/// the last use), redeemed when paid, released when the payment fails or the reservation expires, refunded on refund.
/// The prices are stored as they were at the time, so later price changes never rewrite a past order.
/// </summary>
public class CouponRedemption
{
    public Guid Id { get; set; }
    public Guid CouponId { get; set; }
    public Guid OrderId { get; set; }
    public string ProductId { get; set; } = "";
    public decimal OriginalPrice { get; set; }
    public decimal Discount { get; set; }
    public decimal FinalPrice { get; set; }
    public RedemptionStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime ReservedUntil { get; set; }
}

/// <summary>Uncertain: the connection broke after the request went out — it may have been sent, so it is not retried automatically.</summary>
public enum ResultEmailStatus { Pending = 0, Sending = 1, Sent = 2, Failed = 3, Uncertain = 4 }

/// <summary>
/// A player's request to get the results of a finished game by email — a service email, never marketing consent.
/// One request per player and round (<see cref="IdempotencyKey"/>), so a refresh or a repeated finish never sends twice.
/// </summary>
public class ResultEmailRequest
{
    public Guid Id { get; set; }
    /// <summary>"{roomId}:{round}:{playerId}" — unique.</summary>
    public string IdempotencyKey { get; set; } = "";
    public Guid RoomId { get; set; }
    public int Round { get; set; }
    public Guid PlayerId { get; set; }
    public Guid? GameResultId { get; set; }
    public string ScenarioId { get; set; } = "";
    public string? ProductId { get; set; }
    /// <summary>Lower-cased and trimmed.</summary>
    public string Email { get; set; } = "";
    public bool ResultsRequested { get; set; } = true;
    public DateTime? GameEndedAt { get; set; }
    public DateTime RequestedAt { get; set; }
    public ResultEmailStatus Status { get; set; }
    public int Attempts { get; set; }
    public DateTime? LastAttemptAt { get; set; }
    public DateTime? SentAt { get; set; }
    /// <summary>The id Gmail returned for the sent message (proof the provider accepted it).</summary>
    public string? ProviderMessageId { get; set; }
    /// <summary>A short error code only (never the address or the server's message text).</summary>
    public string? LastError { get; set; }
}

public enum ConsentStatus { Active = 0, Revoked = 1, PendingVerification = 2 }

/// <summary>
/// Explicit consent to marketing email, kept apart from result emails. One row per address: a revoked address stays
/// revoked (and is never mailed) until its owner ticks the consent box again.
/// </summary>
public class MarketingConsent
{
    public Guid Id { get; set; }
    /// <summary>Lower-cased and trimmed; unique.</summary>
    public string Email { get; set; } = "";
    public ConsentStatus Status { get; set; }
    public DateTime ConsentedAt { get; set; }
    /// <summary>Where it was given: the game (scenario id) it was ticked in.</summary>
    public string Source { get; set; } = "";
    public Guid? SourceRoomId { get; set; }
    public string ConsentVersion { get; set; } = "";
    public string ConsentText { get; set; } = "";
    public DateTime? RevokedAt { get; set; }
    /// <summary>Changes on every new consent; part of the signed unsubscribe link, so old links stop working.</summary>
    public string TokenStamp { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// A request to get the link of the updates group. It records only that the link was asked for and shown —
/// never that the person joined the group (that cannot be known).
/// </summary>
public class CommunityLinkRequest
{
    public Guid Id { get; set; }
    public Guid RoomId { get; set; }
    public int Round { get; set; }
    public Guid PlayerId { get; set; }
    public string Source { get; set; } = "";
    /// <summary>Only when the player also gave an address in the same form.</summary>
    public string? Email { get; set; }
    public DateTime RequestedAt { get; set; }
}

/// <summary>Server-only secrets that must survive restarts (e.g. the key that signs unsubscribe links).</summary>
public class AppSecret
{
    public string Name { get; set; } = "";
    public string Value { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

public enum MailAccountStatus { NotConnected = 0, Connected = 1, NeedsReconnect = 2 }

/// <summary>
/// The connected sending mailbox (one row, Id "gmail"). The refresh token is stored only encrypted (AES-GCM, key from
/// GOOGLE_TOKEN_ENCRYPTION_KEY, bound to the mailbox address); access tokens are never stored.
/// </summary>
public class MailAccount
{
    public string Id { get; set; } = "gmail";
    public string Email { get; set; } = "";
    public MailAccountStatus Status { get; set; }
    public string? EncryptedRefreshToken { get; set; }
    /// <summary>A fingerprint of the encryption key the token was sealed with (not the key): a changed key means reconnect.</summary>
    public string? KeyFingerprint { get; set; }
    public string Scopes { get; set; } = "";
    public DateTime? ConnectedAt { get; set; }
    public string? ConnectedBy { get; set; }
    /// <summary>A short error code only (e.g. "invalid_grant"), never a token or Google's full reply.</summary>
    public string? LastError { get; set; }
    public DateTime? LastErrorAt { get; set; }
    public DateTime? LastSendAt { get; set; }
    public DateTime? LastTestSentAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// One OAuth authorization attempt: the state (stored as a hash), the PKCE verifier, the browser binding (hash) and
/// a short expiry. Single use — a used or expired state is refused.
/// </summary>
public class OAuthState
{
    public string StateHash { get; set; } = "";
    public string CodeVerifier { get; set; } = "";
    public string BindingHash { get; set; } = "";
    public string AdminName { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
}

public enum ReferralLinkStatus { Active = 0, Disabled = 1 }

/// <summary>Kept for a later commission plan. Nothing is paid today: the mode is always None.</summary>
public enum CommissionMode { None = 0, Percent = 1, Fixed = 2 }

/// <summary>
/// A personal marketing link ("/r/{Token}"). One per normalized email address. The token is random (128 bits) and says
/// nothing about its owner; it never changes, also when the link is sent again.
/// </summary>
public class ReferralLink
{
    public Guid Id { get; set; }
    public string Token { get; set; } = "";
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    /// <summary>Lower-cased and trimmed; unique.</summary>
    public string Email { get; set; } = "";
    public ReferralLinkStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DisabledAt { get; set; }
    /// <summary>Where the link was made (the site's form).</summary>
    public string Source { get; set; } = "";
    public bool MarketingConsent { get; set; }
    public DateTime? ConsentAt { get; set; }
    public string ConsentVersion { get; set; } = "";
    public string ConsentText { get; set; } = "";
    public DateTime? TermsAcceptedAt { get; set; }
    public DateTime? LastEmailAt { get; set; }
    /// <summary>"sent" (Gmail confirmed), "failed", "uncertain" or "not-configured"; null = never tried.</summary>
    public string? LastEmailStatus { get; set; }
    public string? LastEmailError { get; set; }
    public string? LastEmailMessageId { get; set; }
    public int EmailsSent { get; set; }
    // a later commission plan — not active: nothing is calculated or paid
    public CommissionMode CommissionMode { get; set; }
    public decimal? CommissionRate { get; set; }
    public decimal? FixedCommissionAmount { get; set; }
    public bool CommissionEnabled { get; set; }
}

/// <summary>
/// One visit that opened a personal link. The browser holds only a random visit token in a session cookie; which link
/// it points to stays here. A later link in the same visit replaces it (last click).
/// </summary>
public class ReferralVisit
{
    public Guid Id { get; set; }
    public string TokenHash { get; set; } = "";
    public Guid ReferralLinkId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastClickAt { get; set; }
}

/// <summary>Append-only history of marketing consent: every grant and every revocation, kept for audit.</summary>
public class MarketingConsentEvent
{
    public long Id { get; set; }
    public string Email { get; set; } = "";
    /// <summary>"granted" or "revoked".</summary>
    public string Action { get; set; } = "";
    public string Source { get; set; } = "";
    public string? ConsentVersion { get; set; }
    public DateTime At { get; set; }
}
