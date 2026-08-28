# Scheduling 25-26 Cell Formulas by Sheet

## ScheduleSearchv2
=iferror(sort(FILTER(f!A:F, 
If(B3=True,INT(f!B:B)>= TODAY(),f!B:B<>""),
If(B3=True, Int(f!B:B)<= EOMONTH(TODAY(), 1),f!B:B<>""),If(B1="",f!B:B<>"",INT(f!B:B)=INT(B1)),
If(F2="",f!B:B<>"", REGEXMATCH(f!F:F, "(?i)\b(" & SUBSTITUTE(F2, ", ", "|") & ")\b")),
If(B2="",f!B:B<>"",Regexmatch(f!H:H,"(?i)\b" & B2 & "\b")),
If(D2="",f!B:B<>"",Regexmatch(f!G:G,"(?i)\b" & D2 & "\b")),
If(D3="",f!B:B<>"",Regexmatch(f!D:D,"(?i)\b" & D3 & "\b")),
If(F3="",f!B:B<>"",Regexmatch(f!A:A,"(?i)\b" & F3 & "\b")),
f!A:A<>"Event Name",f!L:L<>True

),2,True),"No matches found matching all criteria")

## EventCard
=FILTER(Calls!A:F,Calls!A:A=C6)

## Master biweekly call times (formula is in multiple locations)
=iferror(FILTER(f!C:F,INT(f!B:B)= B9,f!L:L<>True))

## Biweekly calls only (formula in multiple locations)
=iferror(FILTER(Calls!C:F,INT(Calls!B:B)=B3))

## Filtered Calls Only (formula is in multiple locations)
=iferror(FILTER(Calls!C:F,INT(Calls!B:B)=B3))

## Calls Filter
=FILTER(Calls!B:F, INT(Calls!B:B)>= TODAY(),Int(Calls!B:B)<= EOMONTH(TODAY(), 1))

## Condensed Lineup has a table and adds columns, but the initial columns read =Import!A:A  through =Import!G:G
I think this is where I parsed from, not directly from import?

## Lineup
afterToday: =IF(M82 >= TODAY(), TRUE, FALSE)
Within Next Quarter: =IF(M82 <= EOMONTH(TODAY(), 3), TRUE, FALSE)
Within Next Month: =IF(M82 <= EOMONTH(TODAY(), 1), TRUE, FALSE)

## Piano Tuning 
=FILTER('Condensed Lineup'!A:AC, IF(E1=True, 'Condensed Lineup'!K:K=TRUE,'Condensed Lineup'!J:J=True), 'Condensed Lineup'!J:J=TRUE,'Condensed Lineup'!F:F=TRUE )

## linFilter
=FILTER(Lineup!A:A, Lineup!K:K=TRUE, Lineup!J:J=TRUE)

## Thru Next Q
=FILTER(Lineup!A:A, Lineup!K:K=TRUE, Lineup!J:J=TRUE)

## Thru Next Month
=FILTER(Lineup!A:D, Lineup!L:L=TRUE, Lineup!J:J=TRUE)

## f
=SORT(
  VSTACK(
    IFERROR(LET(data, FILTER(linFilter!A:I, linFilter!A:A<>""), HSTACK(data, ARRAYFORMULA(IF(SEQUENCE(ROWS(data)), "Lineup")))), ),
    IFERROR(LET(
      raw, FILTER(Calls!A:I, Calls!A:A<>"", Calls!A:A<>"Event Title"),
      venue, INDEX(raw,,8),
      newVenue, ARRAYFORMULA(SWITCH(venue, 
        "Main-1-Onstage (1400)", "Main Stage",
        "Main-1-Conference Room (12)", "Conference Room",
        "166-1-Black box (100)", "Theatre 166",
        "General Theatre", "General Theatre",
        "Plaza-Ground-Plaza (400)", "Plaza",
        "Main-2-Ballroom (80)", "Ballroom",
        "Main-Basement-Ghostlight Lounge (100)", "Ghost Light Lounge",
        "166-2-2nd Floor- Theatre 166 (75)", "166 2nd Floor",
        "166-Basement-Dance studio (30)", "166 Basement",
        "Holidays in United States", "Holidays",
        venue)),
      HSTACK(CHOOSECOLS(raw, 1,2,3,4,5,6,7), newVenue, CHOOSECOLS(raw, 9), ARRAYFORMULA(IF(SEQUENCE(ROWS(raw)), "Calls")))
    ), ),
    IFERROR(LET(
      raw, FILTER(PerformanceSpaces!A:I, PerformanceSpaces!A:A<>"", PerformanceSpaces!A:A<>"Event Title"),
      venue, INDEX(raw,,8),
      newVenue, ARRAYFORMULA(SWITCH(venue, 
        "Main-1-Onstage (1400)", "Main Stage",
        "Main-1-Conference Room (12)", "Conference Room",
        "166-1-Black box (100)", "Theatre 166",
        "General Theatre", "General Theatre",
        "Plaza-Ground-Plaza (400)", "Plaza",
        "Main-2-Ballroom (80)", "Ballroom",
        "Main-Basement-Ghostlight Lounge (100)", "Ghost Light Lounge",
        "166-2-2nd Floor- Theatre 166 (75)", "166 2nd Floor",
        "166-Basement-Dance studio (30)", "166 Basement",
        "Holidays in United States", "Holidays",
        venue)),
      HSTACK(CHOOSECOLS(raw, 1,2,3,4,5,6,7), newVenue, CHOOSECOLS(raw, 9), ARRAYFORMULA(IF(SEQUENCE(ROWS(raw)), "PerfCalendars")))
    ), )
  ), 2, TRUE
)
