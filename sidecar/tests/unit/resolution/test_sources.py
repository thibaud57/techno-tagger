import pytest

from tagger.resolution.sources import ApiKeyRejectedRunError, _RejectionGuard


def test_resets_the_rejection_count_on_any_other_answer() -> None:
    guard = _RejectionGuard()
    guard.rejected()
    guard.rejected()
    guard.answered()

    guard.rejected()
    guard.rejected()

    with pytest.raises(ApiKeyRejectedRunError, match="repeated api key rejections"):
        guard.rejected()
