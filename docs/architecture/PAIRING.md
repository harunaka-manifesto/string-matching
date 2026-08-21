# Pairing rules

Target slots are fixed Figma destinations. They are ordered by absolute Y,
then absolute X when the Y difference is at most four pixels, then stable ID.
Only Sheet-copy cards move. Drag is insert behavior, and the same global order
is available through Move up/Move down buttons and dnd-kit keyboard sensors.

The first non-empty Sheet value is the first source card. Blank, whitespace-only,
and formula-empty values are nonexistent and do not consume a destination.
The scan is bounded to 500 physical rows. Duplicate values are independent by
replacement ID/cell.

Skip removes a destination from consumption without moving its numbered slot.
Later values shift into active destinations; extras remain in Unassigned Sheet
copy. An unassigned card is never applied. A target with no source value stays
unchanged.

Already-synced means both `characters` and normalized `name` already equal the
reviewed copy. A rename-only difference counts as a real change. The normalized
name replaces line breaks with spaces, collapses repeated whitespace, and trims
the result; the Sheet string itself is never normalized for Apply.
