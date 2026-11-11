"""Community reports are separate from verified road closures."""
from alembic import op
import sqlalchemy as sa

revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade():
    # Revision 001 historically creates current metadata on a fresh database.
    if not sa.inspect(op.get_bind()).has_table('reports'):
        op.create_table('reports', sa.Column('id', sa.String(40), primary_key=True), sa.Column('data', sa.JSON(), nullable=False))


def downgrade():
    op.drop_table('reports')
