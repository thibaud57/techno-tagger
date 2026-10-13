import errno

import pytest

from tagger.core.file_failures import FileFailureReason, file_failure_reason
from tagger.run.models import FailureReason


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        # winerror 32 fait de cette OSError une PermissionError : le code Windows
        # doit primer sur le type, sinon un verrou passe pour un refus de droits
        (
            OSError(32, "The process cannot access the file", None, 32),
            FileFailureReason.FILE_LOCKED,
        ),
        (PermissionError(13, "Permission denied"), FileFailureReason.PERMISSION_DENIED),
        (FileNotFoundError(2, "No such file or directory"), FileFailureReason.FILE_MISSING),
        (OSError(errno.ENAMETOOLONG, "File name too long"), FileFailureReason.PATH_TOO_LONG),
        (OSError(errno.ENOSPC, "No space left on device"), FileFailureReason.DISK_FULL),
        (OSError(99, "unheard of"), FileFailureReason.WRITE_FAILED),
    ],
    ids=[
        "sharing_violation",
        "access_denied",
        "vanished_file",
        "overlong_path",
        "full_disk",
        "unknown_error",
    ],
)
def test_maps_a_system_error_to_the_project_vocabulary(
    error: OSError, expected: FileFailureReason
) -> None:
    reason = file_failure_reason(error)

    assert reason is expected


def test_track_and_file_failures_share_no_name() -> None:
    """Le protocole n'a qu'un `failure_reason` : un nom en double serait ambigu a l'ecran."""
    file_reasons = {reason.value for reason in FileFailureReason}

    track_reasons = {reason.value for reason in FailureReason}

    assert file_reasons.isdisjoint(track_reasons)
