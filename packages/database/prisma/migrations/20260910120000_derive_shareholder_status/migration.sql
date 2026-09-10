-- ACTIVE when qualifying BUY shares exceed completed SELL shares.
-- INACTIVE when qualifying BUY shares exist but net shares are zero or negative.
-- PENDING when no qualifying BUY exists.
UPDATE shareholders sh SET status = d.status
FROM (
  SELECT s.id,
    (CASE
      WHEN COALESCE(SUM(CASE WHEN r.type = 'BUY'  AND r.status IN ('ACTIVE','COMPLETED') THEN r.quantity END), 0)
         - COALESCE(SUM(CASE WHEN r.type = 'SELL' AND r.status = 'COMPLETED' THEN r.quantity END), 0) > 0 THEN 'ACTIVE'
      WHEN COUNT(r.id) FILTER (WHERE r.type = 'BUY' AND r.status IN ('ACTIVE','COMPLETED')) > 0 THEN 'INACTIVE'
      ELSE 'PENDING'
    END)::"ShareholderStatus" AS status
  FROM shareholders s
  LEFT JOIN registrations r ON r."shareholderId" = s.id
  GROUP BY s.id
) d
WHERE d.id = sh.id AND sh.status <> d.status;
