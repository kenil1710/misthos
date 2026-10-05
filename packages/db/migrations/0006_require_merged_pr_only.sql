-- requireMerged only applies to categories that accept GitHub pull requests. Drop it from every other category
-- (X posts, articles, commits) in stored rubrics; PR categories keep their setting. Idempotent.
UPDATE "programs" p
SET "rubric_json" = jsonb_set(
  p."rubric_json",
  '{categories}',
  (
    SELECT jsonb_agg(
      CASE WHEN c->'sourceTypes' ? 'github_pr' THEN c ELSE c - 'requireMerged' END
      ORDER BY ord
    )
    FROM jsonb_array_elements(p."rubric_json"->'categories') WITH ORDINALITY AS t(c, ord)
  )
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(p."rubric_json"->'categories') c
  WHERE c ? 'requireMerged' AND NOT (c->'sourceTypes' ? 'github_pr')
);
