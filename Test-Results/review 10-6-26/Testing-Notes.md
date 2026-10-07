1. Pushed getRole fix
2. Dev / Test > Verification > Verify Import vs Parent Lineup
    - RangeRef links in audit_log are displaying the Event Name
    - SheetName in audit_log is displaying PARENTCURRENT instead of Parent Lineup for Record Type "Synced"
    - Record Types VERIFY_IMPORT_COMPLETE and COMMAND_COMPLETE share the same info, one in json and the other in readable log type. I think I'd like the readable details to have linebreaks within the cell, that would make it easier to read. 
3. Changed mode from live to draft
    - Should this action be logged? I feel like it would be helpful at least while developing. Or should it be a value in the logs?
4. Dev / Test > Verification > Verify Import vs Parent Lineup
    - RangeRef links returned to reading "Row " ## instead of the Event name.
    - Only rows with a manual review status have the Last Synced field updated. Everything active should have a LastSynced date of 10/6/2026
5. Reviewed Decisions
    a. PARENT_ONLY (already tested and failed in past runs) failed to mark delete
        - MARK_DELETE is only supported for LINEUP_ORPHAN reviews.
    b. LINEUP_DELETE_CLEANUP displays the same evidence repeatedly, but I just checked those rows and they do indeed have an eventID. They also still have an associated UUID and ParentID. 
        - "Lineup row P-E147B097-C01 was deleted. Linked CREWCAL row 85 remains without an EventID."
        - I left these pending and for reference to check that code. 
    c. PARENT_ONLY_NONE_* These rows were empty or only partially deleted. (During a past merge?)
    d. PARENT_LINEUP_DRIFT (from a past run, but wanted to verify this is fixed)
        - I think we fixed this. I also don't understand how a change was detected between seemingly identically parsed values.
        - All of these are comparing Parent Lineup to Lineup. They all have "date" in ChangedFields. The Evidence clearly shows no difference in value though. 
        - Date: Parent="Fri Jan 08 2027 19:30:00 GMT-0500 (Eastern Standard Time)" | Lineup="Fri Jan 08 2027 19:30:00 GMT-0500 (Eastern Standard Time)"
        - all of these remain pending for reference but I think I can delete them soon. 
    e. LINEUP_ORPHAN (1) probably could have been better at identifying the event on the parent lineup, but im sure it already has a new row.
        - Possible candidate for testing merge of lineup events 
        - Review ID not found in audit_log
    f. IMPORT_DRIFT (1)
        - Confidence is low but the eventName is a match. That seems odd. All that changed here was that the date was updated, which is good to know.
        - Marked accept after running apply reviewed decisions, see below.
    g. IMPORT_RENAME
        - This is good, but after accepting Import, it failed to apply. "Import row could not be resolved for the selected Parent Lineup row"
    h. PARENT_ONLY (draft_import)
        - note: while the draft_import has the same import range for testing, I haven't been working much in draft mode and the state of the draft parent and draft lineup definitely are more outdated than live mode
        - In reviewing these, I realized that rows were matched with the same id and then appended rather than replacing or updating the existing row. 
            - Disney's Frozen the Broadway Musical | P-6C681D5A | Active
            - Mainstage Show | P-6C681D5A | Manual Review
        - I like the new evidence structure
            - Likely Import candidates: #1 row 22 "Disney's Frozen the Broadway Musical" (57/100; same series, same venue, openings 8 day(s) apart); #2 row 3 "Guys and Dolls" (40/100; same series, same venue); #3 row 49 "Beautiful: The Carole King Musical " (40/100; same series, same venue). Top candidate is a unique likely relationship; confirm it is the same event before applying changes.
        - I tried to accept import or merge parent which both failed. 
            - Import row could not be resolved for the selected Parent Lineup row
            - mergeParentDuplicate requires two different parent IDs
6. Preview Approved Deletes 
    - this appears to work
    - json format
7. Dev/Test > Diagnostics > Run Health Check
    - Definitely need to update the map registry
    - Field Names (sheet_settings) does not match FieldNames sheet (think this was inconsequential so I thought I would use it to test sheet renaming features at some point)
    - No audit_log entries appeared. 
8. Dev/Test > Diagnostics > Lookup list diagnostics
    - nothing appeared to change
    - no audit_log entries appeared. 
9. Applied reviewed decisions
    - 2 applied, 9 failed, 98 skipped

------------------------
------------------------

1. Some of the decision rows that failed to mark delete no longer had parent rows to apply to. I tried to reject them and accept/mark bypass and they don't have a way to leave the decision list. Shouldn't this be supereseeded instead?
2. I am deleting most of the decision log (aside from the ones mentioned above) to test again. This sheet is so messy. I wish it weren't such a pain to redesign a sheet. 
3. Dev / Test > Verification > Verify Import vs Parent Lineup
    - ParentOnly: 8 - but I don't see them in decision log. I assume these are the ones I have already reviewed.
    - There are 5 rows that were the parent only rows that still have a status of manual review. I think that means checking them against lineup is bypassed, so maybe another status would be appropriate. 
    - I see rows that were marked delete from decisions. 
4. Dev / Test > Verification > Verify Parent Lineup vs Lineup
    - PARENT_LINEUP_DRIFT - ChangedFields: Date. THERE IS NO DISCERNIBLE DIFFERENCE IN THE DATES PRESENTED AS EVIDENCE. The suggested action is to sync parent to lineup. This should not be prompting a decision. They appear to be in sync. 
    - It appears to have changed a row that was marked delete back to manual review. This is not acceptable. 
    - Some lineup update details read "Confirmed current with Parent Lineup." despite prompting a decision. 
5. I am wondering if we also said we would log decisions to idLog at somepoint, there are some entries there. 

------------------------
------------------------

PARENT_ONLY_NONE_P-C9C5F9B3_c97bacae53
{"ReviewID":"PARENT_ONLY_NONE_P-C9C5F9B3_c97bacae53","ReviewType":"PARENT_ONLY","SourceSheet":"","SourceRow":"","SourceID":"","SourceLink":"","CandidateSheet":"Parent Lineup","CandidateRow":65,"CandidateID":"P-C9C5F9B3","CandidateLink":"","ImportTitle":"","ParentTitle":"Partners in Education Workshop:\nTBA (2 of 4)","ExistingParentID":"P-C9C5F9B3","DuplicateParentID":"","VenueEventID":"","VenueUUID":"","MatchedFields":"","ChangedFields":"","ChangedDetails":"","Evidence":"","Confidence":"LOW","SuggestedAction":"REVIEW_PARENT_ONLY","SuggestionReason":"No matching import row found; review before deleting or merging.","SuggestedKeepID":"P-C9C5F9B3","CandidateIDs":"","AffectedRows":"","Decision":"ACCEPT","RequestedAction":"MARK_DELETE","KeepChoice":"KEEP_EXISTING","KeepParentID":"P-C9C5F9B3","ReviewNotes":"Manual decision: ACCEPT","ReviewedBy":"Manual reviewer","ReviewedAt":{"__scheduler3Type":"Date","value":"2026-10-06T02:01:28.669Z"},"ActionStatus":"FAILED","ActionedAt":{"__scheduler3Type":"Date","value":"2026-10-07T00:36:27.966Z"},"ActionDetails":"MARK_DELETE is only supported for LINEUP_ORPHAN reviews.","CandidateTitle":"Partners in Education Workshop:\nTBA (2 of 4)"}
Parent-only review PARENT_ONLY_NONE_P-C9C5F9B3_c97bacae53 was already applied; row retained. (The decision was mark delete. It just never got ingested before overwriting)