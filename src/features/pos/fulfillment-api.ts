import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'

import {
  INITIAL_FULFILLMENT,
  isBackwardStep,
  isForwardStep,
  type FulfillmentStatus,
} from '@/features/pos/fulfillment'
import { db } from '@/lib/firebase'

interface Mover {
  /** The signed-in Firebase account. Rules require updatedBy to equal this uid. */
  user: { uid: string; displayName: string }
  /**
   * The POS operator making the move. Separate from `user` on purpose, exactly as on an
   * order and a payment: one shared login serves the whole shift, so the account cannot say
   * who was at the counter.
   *
   * When nobody has been selected — an admin working from the office, say — the caller
   * passes the signed-in account's own identity, which the rules accept as the self-operator
   * form.
   */
  staff: { id: string; name: string }
}

export interface SetFulfillmentParams extends Mover {
  /** Where the order is now, as the app currently sees it. */
  from: FulfillmentStatus
  /** Where it should go. Must be exactly one step forward of `from`. */
  to: FulfillmentStatus
}

/**
 * Writes the current-state document and its journal entry **in one batch**.
 *
 * Two documents, because they answer two different questions. The parent holds the current
 * status and whoever moved it last; the journal beneath it holds every individual step with
 * the operator who made it. Without the journal, Bob marking an order ready would overwrite
 * the fact that Alice started preparing it — and who did which step is precisely what
 * operator identities exist to record.
 *
 * Batched so the journal can never gain an entry without the status moving, or vice versa.
 * The same shape as `updateMenuItem`, which batches a cost and its history entry for exactly
 * this reason. Note the limit of that guarantee: rules cannot *require* a companion write,
 * so the pairing is enforced by funnelling every transition through this function rather
 * than by the database. The journal being append-only means a missing entry can never be
 * disguised, only noticed.
 */
async function writeTransition(
  orderId: string,
  { from, to, user, staff }: SetFulfillmentParams,
): Promise<void> {
  const batch = writeBatch(db)

  batch.set(doc(db, 'orderFulfillment', orderId), {
    orderId,
    status: to,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.displayName,
    // The rules check this identity exists, is active, and that the name matches theirs
    // right now — so the snapshot is provably accurate at the moment of the move.
    updatedByStaffId: staff.id,
    updatedByStaffName: staff.name,
  })

  batch.set(doc(collection(db, 'orderFulfillment', orderId, 'transitions')), {
    orderId,
    from,
    to,
    at: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.displayName,
    updatedByStaffId: staff.id,
    updatedByStaffName: staff.name,
  })

  await batch.commit()
}

/**
 * Moves an order one step along the kitchen workflow.
 *
 * Touches only `orderFulfillment/{orderId}` and its `transitions` subcollection — the order
 * document is never written, which is what keeps its immutability guarantee intact. The same
 * shape as `voidOrder` and `recordPayment`, for the same reason.
 *
 * `pending` is represented by the parent document's absence, so a newly placed order costs
 * no write at all, and the rules can tell a first move (`create`, only ever into
 * `preparing`) from a later one (`update`, one step at a time) without having to trust a
 * field the client supplied.
 *
 * Backward moves are not offered here. An admin correcting a mis-tap uses
 * `correctFulfillment`, which the rules permit only for them.
 *
 * A voided order is refused at the server, as is any step that is not exactly one place
 * forward and any operator who is not who they say they are — none of those checks is
 * duplicated here as enforcement; `canAdvanceFulfillment` hides the button, a different job.
 */
export async function setFulfillment(orderId: string, params: SetFulfillmentParams): Promise<void> {
  if (!isForwardStep(params.from, params.to)) {
    throw new Error('That is not the next step for this order.')
  }
  await writeTransition(orderId, params)
}

export interface CorrectFulfillmentParams extends Mover {
  from: FulfillmentStatus
  to: FulfillmentStatus
}

/**
 * Steps an order **back** one place. Admin-only, enforced by firestore.rules rather than
 * here — a staff account calling this gets permission-denied from the server.
 *
 * This exists because the forward path is otherwise a one-way door: a mis-tapped "Mark
 * delivered" on a busy counter would strand the order in a state nobody could undo. Keeping
 * the correction with admins means the person fixing the mistake is not the person who made
 * it, which is the same reasoning that keeps voiding away from the till.
 *
 * The correction is journalled like any other step, so the trail shows that it happened and
 * who did it rather than quietly rewinding.
 */
export async function correctFulfillment(
  orderId: string,
  params: CorrectFulfillmentParams,
): Promise<void> {
  if (!isBackwardStep(params.from, params.to)) {
    throw new Error('A correction may only step back one place.')
  }
  await writeTransition(orderId, params)
}

/** Where the very first transition starts from. Exported so callers need not import both. */
export const FULFILLMENT_ORIGIN = INITIAL_FULFILLMENT
