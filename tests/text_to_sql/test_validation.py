import unittest

from api.services.text_to_sql.validation import guard

# Run from the project root: uv run python -m unittest discover -s tests -t .


class GuardTest(unittest.TestCase):
    def test_accepts_select_and_with(self):
        self.assertEqual(guard('SELECT 1;'), 'SELECT 1')
        self.assertEqual(guard('  with t as (select 1) select * from t  '), 'with t as (select 1) select * from t')

    def test_comments_are_kept_but_not_checked(self):
        self.assertEqual(guard('-- delete nothing\nSELECT 1 /* drop; */'), '-- delete nothing\nSELECT 1 /* drop; */')

    def test_rejects_writes_and_multiple_statements(self):
        for sql in [
            'DELETE FROM gold.fact_sales',
            'SELECT 1; DROP TABLE gold.dim_store',
            'WITH x AS (DELETE FROM gold.dim_date RETURNING 1) SELECT * FROM x',
            'SELECT pg_read_file(\'/etc/passwd\')',
            'SELECT * FROM dblink(\'x\', \'y\')',
            '',
        ]:
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                guard(sql)

    def test_words_inside_strings_and_identifiers_are_fine(self):
        guard("SELECT * FROM gold.dim_product WHERE product_name = 'Delete; drop'")
        guard('SELECT last_updated, is_out_of_stock FROM gold.fact_inventory ORDER BY 1 OFFSET 5')


if __name__ == '__main__':
    unittest.main()
