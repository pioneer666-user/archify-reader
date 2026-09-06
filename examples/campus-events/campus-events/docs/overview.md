# Campus Event Registration — reading details

These notes accompany the registration workflow diagram. They are written
for readers who have seen the diagram but not the code. The sample system is
fictional and exists so the whole flow can be shared and rerun openly.

## Registration Form

### Where this starts

This is the entry of the whole flow. The student picks an event and submits
the sign-up form; no rule has been applied yet at this point.

### What happens here

The portal accepts the submission and hands it, unchanged, to the
registration service. If the service refuses the entry, the reason comes
back to this form so the student can read it.

### Where this ends

This step ends as soon as the entry is handed over. What happens next is
decided by [Check Eligibility](node:check_eligibility).

## Check Eligibility

### Where this starts

This step takes over from [Registration Form](node:submit_registration) with
one fresh entry that nothing has judged yet.

### The rules applied here

Two rules are checked, one after the other, before anything is written.
First, the student's account must exist and be in good standing; an account
that has been suspended may not register at all. Second, the same student
may hold only one entry for the same event; one earlier entry is enough to
stop a new one.

### When a rule fails

The entry stops here and turns into [Reject Entry](node:reject_registration).
No seat is reserved and no record is written — the refusal happens before
the save stage.

### Where this ends

An entry that passes both rules continues to
[Create Registration](node:create_record), which is the only step that
writes.

## Reject Entry

### Where this starts

This outcome takes over from [Check Eligibility](node:check_eligibility)
when one of its two rules failed.

### What the student sees

The refusal carries a reason written for the student: an unknown account, an
account that may not register, or an earlier entry for the same event. The
portal shows this reason next to the form.

### Where this ends

This is an end point of the flow. Nothing was written anywhere and no seat
count moved; the student can change something and submit again.

## Create Registration

### Where this starts

This step takes over from [Check Eligibility](node:check_eligibility) with
an entry that passed both rules. From here on, the flow starts writing.

### The rules applied here

Every event carries a fixed capacity and a remaining-seat count with it; the
two numbers belong to the event itself, not to the student's entry.

### What happens, in order

The step opens one save operation and reads the event inside it, so the seat
count cannot change halfway. If a seat is left, the entry is marked as
holding a seat and the remaining count drops by one. If the event is full,
the entry is marked for the waiting list instead and no seat moves. The
entry itself is written inside the same save operation, and only then is the
save finished.

### If the save fails midway

Nothing half-written survives: the save is undone as a whole, so a seat is
never deducted without a matching entry, and no entry appears without its
seat.

### Where this ends

An entry that got a seat continues to
[Send Confirmation](node:send_confirmation). An entry for a full event goes
to [Add to Waitlist](node:waitlist_entry) — same save, different marking.

## Add to Waitlist

### Where this starts

This outcome takes over from [Create Registration](node:create_record) when
the event was already full at the moment of saving.

### What happens here

The entry is still written, but as a waiting-list place: it holds no seat
and leaves the event's seat count untouched. Being on the list is a real
record, not an error.

### Where this ends

The written place also produces a waiting-list message, which continues to
[Send Confirmation](node:send_confirmation). Moving a student from the list
into a free seat later is an organiser action; it is not part of this flow.

## Send Confirmation

### Where this starts

This step takes over from [Create Registration](node:create_record) once the
entry is safely written — both entries holding a seat and waiting-list
places come here.

### What happens here

A short message is picked to match the outcome — a seat confirmation or a
waiting-list notice — and stored in the student's notification list. In this
sample the message is recorded rather than really sent, so the whole flow
can run offline.

### If the message cannot be stored

The entry itself is already saved at this point. A message that fails to be
stored only means the student sees nothing new; it never undoes the entry or
frees the seat.

### Where this ends

This is the end of the flow. What happens afterwards — reading the entry,
checking in on the day, or clearing the waiting list — is started by someone
else later, not by this flow.
