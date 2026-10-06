import { linaInputBlock } from './inputBlock';

/** One responsibility in an illustrative design walkthrough, never a runtime event. */
export interface LinaExecutionStep {
  nodeId: string;
  detail: string;
  choices: { target: string; label: string; detail: string }[];
}

/** Outcomes describe the boundary reached, not evidence that Lina executed work. */
export interface LinaExecutionPath {
  id: string;
  title: string;
  description: string;
  steps: LinaExecutionStep[];
  outcome: string;
}

const choiceDetails: Record<string, string> = {
  submission: 'The authenticated CLI submits transport facts to the shared service.',
  event: 'The messaging adapter preserves the original event and reply destination.',
  'valid envelope': 'Continue valid input to identity resolution; route malformed input to visible failure.',
  'identity evidence, including unknown': 'Pass verified identity evidence or unknown identity to the current source-access policy.',
  'not admitted': 'Offer pairing or refuse the source before conversation routing or execution.',
  admitted: 'Check activation only after current source admission.',
  'authorized route': 'Claim source identity after checking access to the selected conversation.',
  duplicate: 'Return the recorded input status without admitting another turn.',
  'new claim': 'Classify the operation for a newly claimed source event.',
  'operation denied': 'Refuse an operation whose permission or target check fails.',
  'attachments required': 'Secure the required originals before promising acceptance.',
  'no attachments': 'Attachment-free input can proceed directly to durable acceptance.',
  'required custody secured': 'Proceed only when the required originals are durable.',
  accepted: 'Dispatch the recorded operation; acceptance does not imply execution has started.',
  'acceptance receipt': 'Hand the receipt to delivery separately from dispatching accepted work.',
  'ordinary input': 'Pass through the collector; CLI input does not wait for a batch.',
  'single input or batch': 'Preserve the input identities and order when checking conversation ownership.',
  'turn control': 'Dispatch explicit Queue for an authorized conversation, or Steer, Interrupt, and Stop for an exact turn, outside batching.',
  'waiting answer': 'Resolve the specific pending prompt under responder permission checks.',
  'other command': 'Apply the command\'s own permission and busy policy without ordinary queueing.',
  'admitted execution': 'Transfer admitted work to the runtime boundary; model and tool execution live there.',
  'ordinary busy policy: Steer / Interrupt': 'Apply the selected ordinary-input busy policy to its authorized active turn. No default is settled.',
  'replacement after safe owner release': 'Recheck replacement admission only after safe release and reconciliation of uncertain outcomes.',
  'resolution result': 'Deliver prompt resolution or a visible rejection to the incoming destination.',
  'command result': 'Deliver the command result without creating an ordinary agent turn.',
  'control result': 'Report control admission; guidance consumption and completed cancellation are distinct.',
  'challenge / refusal': 'Hand the challenge or refusal to delivery. Approval is a separate interaction.',
  'existing status': 'Deliver status tied to the original input and its recorded state.',
  'unstarted accepted input only': 'Restore existing accepted work for dispatch only when recorded execution has not started and authorization still permits it.',
  'DM/CLI or addressed group': 'Continue admitted DM or CLI input and group input that mentions or replies to Lina.',
  'unaddressed group': 'Ignore approved group traffic that does not mention or reply to Lina.',
  'invalid envelope': 'Report malformed transport facts or content before source admission.',
  'route refused / invalid selection': 'Report a conversation selection or access failure without claiming new work.',
  'custody acquisition / validation failed': 'Stop before acceptance when a required original cannot be retrieved or validated.',
  'persistence failed / outcome unknown': 'Report failed persistence and inspect uncertain commit state before promising acceptance.',
  'visible refusal / failure': 'Hand the refusal or unresolved state to delivery at the available originating destination.',
  'incomplete / retryable claimed receipt': 'Inspect a pre-acceptance claim before choosing takeover, existing status, or intervention.',
  'safe reclaim only': 'Proposed: reclaim only safely abandoned pre-acceptance work after custody and persistence checks.',
  'live owner / accepted / terminal receipt': 'Return recorded status when another owner is live or acceptance or a terminal result already exists.',
  'unsafe / unknown custody; no blind retry': 'Stop for inspection when custody or acceptance state is uncertain. Do not blindly retry.',
  'ordinary busy policy: Queue': 'Proposed: retain an ordinary accepted input when its selected busy policy is Queue.',
  'explicit Queue / unsupported Steer': 'Proposed: enqueue explicit conversation-targeted Queue or an authorized steering fallback.',
  'owner release / resume; recheck admission': 'Recheck current authorization and ownership after safe release or an authorized resume. Ordering remains open.',
  'lifecycle event: owner released': 'Notify pending work when the runtime owner releases the conversation. This is a lifecycle notification, not another input.',
  'safe checkpoint resume': 'Resume existing execution only after recorded progress and outcomes establish safety.',
  'saved answer; no execution rerun': 'Deliver the saved answer under its delivery policy without repeating execution.',
  'uncertain execution / side effects': 'Inspect uncertain effects or request a decision before any continuation.',
  'known safe follow-up / resume only': 'Continue only after reconciliation establishes a safe action. Exact mechanisms remain open.',
  'recorded status / decision needed': 'Deliver recorded reconciliation status or the need for an explicit decision.',
};

function step(name: string, detail: string): LinaExecutionStep {
  const nodeId = `lina-input-${name}`;
  return {
    nodeId,
    detail,
    choices: linaInputBlock.edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => ({
        target: edge.target,
        label: edge.label,
        detail: choiceDetails[edge.label] ?? edge.label,
      })),
  };
}

function incoming(channel: 'cli' | 'telegram' | 'whatsapp'): LinaExecutionStep[] {
  return [
    step(channel, channel === 'cli'
      ? 'The owner submits through an authenticated client connection. Authentication and reconnect details remain open.'
      : 'The adapter preserves sender, event, chat, and reply facts. Transport acknowledgement timing remains open.'),
    step('envelope', 'Validate the envelope and retain original content separately from prepared model input.'),
    step('identity', 'Resolve verified channel links or CLI identity. Display names cannot establish authority.'),
    step('access', 'Check current DM or group admission. Group and DM approvals are separate.'),
  ];
}

function newInput(channel: 'cli' | 'telegram' | 'whatsapp'): LinaExecutionStep[] {
  return [
    ...incoming(channel),
    step('activation', 'Agreed: approved group input activates Lina only on a mention or reply. CLI and admitted DMs proceed directly; exact channel rules remain open.'),
    step('conversation', 'Select the authorized personal conversation or group/topic history. Linked accounts do not merge old histories.'),
    step('claim', 'Claim the source event identity durably. Identical text alone is not a duplicate.'),
    step('intent', 'Classify and authorize the operation. Queue targets a conversation; Steer, Interrupt, and Stop target an exact turn. Waiting answers retain their prompt and turn IDs.'),
  ];
}

function accepted(channel: 'cli' | 'telegram' | 'whatsapp'): LinaExecutionStep[] {
  return [
    ...newInput(channel),
    step('accept', 'Persist responsibility before confirming acceptance. A persistence failure must not produce an acceptance promise.'),
    step('dispatch', 'Dispatch the accepted operation. Immediate-control persistence and recovery claims remain open.'),
  ];
}

/**
 * Design walkthroughs grounded in inputBlock edges and input-design.md.
 * Steps illustrate selected branches, not an executable workflow or measured run.
 * Terminal outcomes cover failures and external boundaries without inventing edges.
 */
export const linaExecutionPaths: LinaExecutionPath[] = [
  {
    id: 'cli-message',
    title: 'CLI message',
    description: 'The owner sends ordinary text to the selected conversation while it is idle.',
    steps: [
      ...accepted('cli'),
      step('burst', 'Pass the CLI submission through as one input. CLI batching is disabled.'),
      step('admission', 'Admit ordinary work when conversation ownership permits. Ownership and leases remain proposed.'),
      step('runtime', 'Transfer input, turn identity, authority, and destination to runtime-owned work.'),
    ],
    outcome: 'Execution handoff reached. Model calls, tools, and final-answer delivery belong to later responsibilities. A CLI disconnect after acceptance does not cancel work.',
  },
  {
    id: 'telegram-message',
    title: 'Telegram message',
    description: 'An approved sender mentions Lina or replies to it in an approved group topic.',
    steps: [
      ...accepted('telegram'),
      step('burst', 'Collect eligible text only from the same sender and conversation. Preserve each message identity and order.'),
      step('admission', 'Admit the group/topic work when idle. Group access does not expose private conversation history.'),
      step('runtime', 'Hand off the admitted work with the original Telegram topic and reply anchor.'),
    ],
    outcome: 'Execution handoff reached. The eventual answer belongs at the originating topic. Exact channel activation rules and batching delays remain open.',
  },
  {
    id: 'whatsapp-attachment',
    title: 'WhatsApp attachment',
    description: 'The owner sends a supported attachment through an approved linked DM.',
    steps: [
      ...newInput('whatsapp'),
      step('custody', 'Retrieve and validate the required original, then retain its attachment ID, caption, and order. WhatsApp integration capabilities remain open.'),
      step('accept', 'Persist the accepted input with durable attachment references and its original destination.'),
      step('dispatch', 'Route this ordinary attachment input to collection and conversation admission.'),
      step('burst', 'Keep this input separate unless transport identity establishes an album. Timing alone cannot establish one.'),
      step('admission', 'Admit work with the original attachment references when the conversation is available.'),
      step('runtime', 'Transfer originals to context preparation. Transcription and extraction do not overwrite them.'),
    ],
    outcome: 'Execution handoff reached. Processing providers, attachment limits, and retention remain open. Shared personal history does not change the WhatsApp reply destination.',
  },
  {
    id: 'pairing-or-refusal',
    title: 'Pairing or refusal',
    description: 'An unknown Telegram DM sender requests owner-approved access.',
    steps: [
      ...incoming('telegram'),
      step('pairing', 'Agreed: offer an unknown DM sender a pairing challenge for owner approval. Chat approval does not grant administrative authority.'),
      step('delivery', 'Hand the challenge or refusal to the originating adapter.'),
    ],
    outcome: 'No agent execution is admitted. Owner approval and a later message are separate interactions. Code expiry, retry limits, and refusal response policy remain open.',
  },
  {
    id: 'duplicate-message',
    title: 'Duplicate delivery',
    description: 'Telegram redelivers an event whose acceptance confirmation was lost.',
    steps: [
      ...incoming('telegram'),
      step('activation', 'Check mention or reply activation for approved group traffic; admitted DMs proceed directly.'),
      step('conversation', 'Authorize the selected current route. The receipt lookup will identify any stored original conversation.'),
      step('claim', 'Find the persisted receipt for this channel, adapter account, scope, and source event ID.'),
      step('duplicate', 'Recheck access to the stored original conversation before returning its recorded status. Current routing must not expose old private history.'),
      step('delivery', 'Hand the existing status to delivery without creating a new turn.'),
    ],
    outcome: 'Existing status is handed off. Duplicate admission does not guarantee exactly-once tool effects. Missing source IDs and expired receipts remain open.',
  },
  {
    id: 'attachment-failure',
    title: 'Attachment acquisition fails',
    description: 'A required WhatsApp attachment cannot be retrieved or fails type or size validation.',
    steps: [
      ...newInput('whatsapp'),
      step('custody', 'The required original is unavailable or unsupported. Stop before durable acceptance.'),
      step('failure', 'Agreed: report failed acquisition without claiming acceptance or that Lina read the content. Partial-input acceptance remains open.'),
      step('delivery', 'Hand the failure to the originating WhatsApp destination.'),
    ],
    outcome: 'Visible failure reaches delivery. No accepted work or runtime handoff exists for this input. Partial-input acceptance and failure delivery policy remain open.',
  },
  {
    id: 'group-not-activated',
    title: 'Group message ignored',
    description: 'An approved Telegram group sender posts without mentioning or replying to Lina.',
    steps: [
      ...incoming('telegram'),
      step('activation', 'Agreed: this approved group message lacks the mention or reply required for activation.'),
      step('ignored', 'Leave the message unactivated. Do not create an ordinary turn or send an agent answer.'),
    ],
    outcome: 'No execution is admitted. Exact channel activation rules remain open.',
  },
  {
    id: 'malformed-envelope',
    title: 'Malformed input',
    description: 'A CLI submission fails envelope validation.',
    steps: [
      step('cli', 'Receive an authenticated submission and its response destination.'),
      step('envelope', 'Required transport facts or content structure fail validation.'),
      step('failure', 'Record the validation failure without accepting execution responsibility.'),
      step('delivery', 'Hand the failure to the available CLI response destination.'),
    ],
    outcome: 'Validation failure reaches delivery. Exact schema requirements and failure records remain open.',
  },
  {
    id: 'conversation-denied',
    title: 'Conversation access denied',
    description: 'An authenticated CLI client selects a conversation it cannot access.',
    steps: [
      ...incoming('cli'),
      step('activation', 'Admitted CLI input proceeds directly to conversation authorization.'),
      step('conversation', 'Agreed: reject selection of a conversation the actor cannot access.'),
      step('failure', 'Record a routing refusal without claiming the source event or admitting execution.'),
      step('delivery', 'Hand the refusal to the CLI destination.'),
    ],
    outcome: 'Conversation refusal reaches delivery without exposing the selected history.',
  },
  {
    id: 'acceptance-persistence-failure',
    title: 'Acceptance persistence fails',
    description: 'An authorized text input cannot be durably accepted.',
    steps: [
      ...newInput('cli'),
      step('accept', 'Persistence fails before durable acceptance can be confirmed.'),
      step('failure', 'Agreed: report persistence failure instead of promising acceptance. An uncertain commit needs a recorded-state check.'),
      step('delivery', 'Hand the failure to the originating CLI destination.'),
    ],
    outcome: 'No acceptance promise or execution dispatch occurs. Transaction boundaries and uncertain-commit resolution remain open.',
  },
  {
    id: 'abandoned-claim-retry',
    title: 'Recover an abandoned claim',
    description: 'Telegram redelivers text after a crash left a source claim before acceptance.',
    steps: [
      ...incoming('telegram'),
      step('activation', 'Check activation for the admitted source.'),
      step('conversation', 'Authorize the selected current route before looking up its source receipt.'),
      step('claim', 'Find the persisted pre-acceptance claim for this same source event.'),
      step('claim-recovery', 'Proposed: recheck access to the stored original conversation, then take over only a safely abandoned claim after checking durable state. No accepted record or uncertain custody or acceptance outcome exists.'),
      step('intent', 'Recheck the operation and permission for this attachment-free text input.'),
      step('accept', 'Persist acceptance under the original input identity before confirming responsibility.'),
      step('dispatch', 'Dispatch the recorded ordinary input.'),
      step('burst', 'Preserve the original identity when collecting eligible messaging text.'),
      step('admission', 'Recheck ownership and authorize execution when safely available.'),
      step('runtime', 'Hand the existing input to runtime as one admitted turn.'),
    ],
    outcome: 'Safe claim recovery reaches execution handoff. Claim ownership, transactions, and takeover timing remain proposed; attachment recovery needs separate custody checks.',
  },
  {
    id: 'uncertain-claim',
    title: 'Claim outcome needs inspection',
    description: 'A redelivered event has a pre-acceptance claim whose custody or persistence outcome cannot be established.',
    steps: [
      ...incoming('telegram'),
      step('activation', 'Check activation for the admitted source.'),
      step('conversation', 'Authorize the selected current route before looking up its source receipt.'),
      step('claim', 'Find an existing claim without a confirmed accepted receipt.'),
      step('claim-recovery', 'Check access to the stored original conversation and inspect custody and acceptance state. An uncertain outcome prevents safe takeover.'),
      step('failure', 'Expose the unresolved claim state. Do not blindly retrieve, persist, or dispatch again.'),
      step('delivery', 'Hand the unresolved status to the incoming destination.'),
    ],
    outcome: 'Claim recovery stops for inspection or a decision. Exact reconciliation and failure-state mechanisms remain open.',
  },
  {
    id: 'busy-queue',
    title: 'Queue while busy',
    description: 'The owner selects Queue for a new CLI message while another turn owns the conversation.',
    steps: [
      ...accepted('cli'),
      step('control', 'Agreed: route explicit Queue outside ordinary batching. Target the authorized conversation, without requiring a particular active turn.'),
      step('queue', 'Proposed: leave the active turn unchanged and retain this accepted input for later admission in arrival order.'),
    ],
    outcome: 'Proposed queue behavior leaves the active turn unchanged. No runtime handoff has occurred for this input. Queue limits and ordering after failure or uncertain work remain open.',
  },
  {
    id: 'ordinary-busy-queue',
    title: 'Ordinary input waits in queue',
    description: 'An ordinary CLI message follows the selected Queue busy policy while another turn owns its conversation.',
    steps: [
      ...accepted('cli'),
      step('burst', 'Pass the ordinary CLI input through without batching.'),
      step('admission', 'Proposed: apply the selected Queue busy policy for this authorized conversation.'),
      step('queue', 'Retain the accepted input while the active owner continues. Proposed arrival ordering does not settle failure ordering.'),
      step('admission', 'After safe owner release or an authorized resume, recheck authorization and conversation ownership.'),
      step('runtime', 'Start a later turn only after safe admission.'),
    ],
    outcome: 'The illustrative queue drains to execution handoff after safe release. Queue limits, failure ordering, and resume policy remain open.',
  },
  {
    id: 'explicit-interrupt',
    title: 'Explicit Interrupt replacement',
    description: 'The owner submits an Interrupt control with a replacement message and an exact active turn ID.',
    steps: [
      ...accepted('cli'),
      step('control', 'Agreed: route explicit Interrupt outside ordinary batching and target the exact turn. Proposed: request cancellation and inspect completed or uncertain outcomes.'),
      step('admission', 'Proposed: admit replacement only after safe owner release and reconciliation. A timeout alone cannot establish safety.'),
      step('runtime', 'Hand the replacement to runtime as a new turn.'),
    ],
    outcome: 'This proposed path assumes safe cancellation and release. Replacement priority, older queued work, child cancellation, and partial output remain open.',
  },
  {
    id: 'busy-steer',
    title: 'Steer active work',
    description: 'An authorized Telegram participant submits guidance for a specific active turn.',
    steps: [
      ...accepted('telegram'),
      step('control', 'Agreed: check the exact target turn and compatible execution authority. Proposed steering retains guidance for a supported boundary; unavailable steering falls back to queueing.'),
      step('delivery', 'Report whether guidance was admitted through the incoming Telegram destination.'),
    ],
    outcome: 'Control status is handed off. Admission does not prove guidance was consumed. The original final-answer destination stays attached to the original request. Steering boundaries remain proposed.',
  },
  {
    id: 'busy-interrupt',
    title: 'Ordinary busy policy interrupts',
    description: 'An ordinary CLI message follows a selected Interrupt busy policy. This is distinct from an explicit Interrupt control.',
    steps: [
      ...accepted('cli'),
      step('burst', 'Pass through the replacement input without batching.'),
      step('admission', 'Route the selected Interrupt policy to turn control for the recorded active turn.'),
      step('control', 'Request cancellation. Reconcile completed and uncertain tool outcomes before releasing ownership.'),
      step('admission', 'Recheck replacement admission after safe release. A cancellation timeout alone cannot establish safety.'),
      step('runtime', 'Hand the replacement to runtime as a new turn only after safe admission.'),
    ],
    outcome: 'This proposed walkthrough assumes safe cancellation and release. Cancellation cannot undo completed effects. Replacement priority, older queued messages, and child cancellation remain open.',
  },
  {
    id: 'busy-stop',
    title: 'Stop active work',
    description: 'An authorized CLI client requests Stop for the exact active turn without a replacement message.',
    steps: [
      ...accepted('cli'),
      step('control', 'Agreed: request cancellation of the exact target turn. A stale request must not silently affect a newer turn. Cancellation details remain proposed.'),
      step('delivery', 'Report the cancellation request and known status to the CLI destination.'),
    ],
    outcome: 'Control status is handed off without a replacement turn. A request is not proof that all work stopped. Queue pausing, child cancellation, and partial output treatment remain open.',
  },
  {
    id: 'waiting-answer',
    title: 'Answer waiting work',
    description: 'An approved sender uses /approve with a prompt ID while ordinary work is waiting.',
    steps: [
      ...accepted('telegram'),
      step('prompt', 'Match the exact pending prompt and owning turn, then check responder permission. Plain yes grants no approval; unambiguous text may answer a clarification.'),
      step('delivery', 'Report resolution or a visible stale, ambiguous, or unauthorized-answer rejection.'),
    ],
    outcome: 'The prompt result is handed off outside ordinary batching and queueing. Runtime resumption belongs to waiting work. Restricted-tool approvers and prompt expiry remain open.',
  },
  {
    id: 'recovered-unstarted-input',
    title: 'Recover unstarted input',
    description: 'After restart, an accepted ordinary CLI input has not started execution.',
    steps: [
      step('recovery', 'Agreed: read the existing accepted input, restore ordering, and recheck authorization. Confirm that execution never started.'),
      step('dispatch', 'Restore the accepted ordinary operation using its existing identity.'),
      step('burst', 'Keep the CLI input as one submission without batching.'),
      step('admission', 'Check safe conversation ownership before admitting the restored work.'),
      step('runtime', 'Hand the restored input to runtime as an admitted turn.'),
    ],
    outcome: 'Eligible accepted input reaches execution handoff. Recovery claims, ordering mechanics, and ownership remain proposed.',
  },
  {
    id: 'recovered-saved-answer',
    title: 'Retry saved answer delivery',
    description: 'Execution completed and saved an answer, but a known temporary delivery failure prevented sending it.',
    steps: [
      step('recovery', 'Agreed: retrieve the saved answer, original destination, and known delivery state. Recheck authorization.'),
      step('delivery', 'Retry the saved output under the delivery policy. Do not rerun agent execution.'),
    ],
    outcome: 'The saved answer reaches delivery. Retry budgets and permanently unavailable destination handling remain open; an uncertain send needs reconciliation.',
  },
  {
    id: 'recovered-safe-execution',
    title: 'Resume safely interrupted work',
    description: 'Recorded progress establishes that interrupted execution can resume without repeating uncertain operations.',
    steps: [
      step('recovery', 'Agreed: inspect recorded progress and tool outcomes, recheck authority, and establish safe resumption.'),
      step('runtime', 'Resume the existing turn from safe recorded progress. Checkpoint and ownership mechanics remain proposed.'),
    ],
    outcome: 'Safely recoverable work reaches the runtime boundary. Exact checkpoints and recovery protocol remain open.',
  },
  {
    id: 'recovered-uncertain-operation',
    title: 'Reconcile an uncertain operation',
    description: 'Interrupted execution includes a tool operation whose side-effect outcome is unknown.',
    steps: [
      step('recovery', 'Agreed: inspect recorded progress and identify the uncertain tool outcome. Do not repeat the operation blindly.'),
      step('reconcile', 'Inspect external evidence where possible or request a decision. No safe continuation is established by this walkthrough.'),
    ],
    outcome: 'Reconciliation or an explicit decision is required. The map ends here because checkpoint and reconciliation mechanisms remain open.',
  },
  {
    id: 'recovered-command',
    title: 'Recover a command',
    description: 'After restart, an accepted but unstarted status command is eligible for dispatch; sending its result has an uncertain outcome.',
    steps: [
      step('recovery', 'Read the accepted record, recheck current authorization, and inspect progress. Restore only eligible work; uncertain side effects require reconciliation.'),
      step('dispatch', 'Restore the existing accepted command rather than claim a new incoming event.'),
      step('command', 'Return current status without launching an agent turn. Other commands need their own busy and permission policies.'),
      step('delivery', 'Keep the saved result and original destination. An uncertain send requires reconciliation where supported.'),
    ],
    outcome: 'Command result reaches the delivery boundary. Known temporary failure may retry the saved result without rerunning an agent; uncertain sends must not silently resend. Recovery claims, reconciliation, and retry budgets remain open.',
  },
];
