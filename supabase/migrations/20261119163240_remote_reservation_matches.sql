-- A single official remote match can reserve both physical sides. One reservation
-- counts distinct matches, even if it supplies both boards.
alter table dartflow_private.reservation_matches drop constraint if exists reservation_matches_match_id_key;
alter table dartflow_private.reservation_matches drop constraint if exists reservation_matches_pkey;
alter table dartflow_private.reservation_matches add constraint reservation_matches_pkey primary key(reservation_id,match_id,board_id);
create unique index if not exists reservation_matches_match_board on dartflow_private.reservation_matches(match_id,board_id);
