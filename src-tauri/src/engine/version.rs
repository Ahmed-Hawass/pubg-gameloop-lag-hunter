// version.rs — release comparison on the engine side (mirrors src/version.ts):
// plain x.y.z numeric comparison. Text comparison was the old bug — an older
// longer tag read as "update available".

/// Parse "1.2.3" into numeric components; missing parts count as 0.
fn parts(v: &str) -> Vec<u64> {
    v.split('.')
        .map(|p| p.parse::<u64>().unwrap_or(0))
        .collect()
}

// >0 when remote is newer than local, 0 when equal, <0 when older.
// Non-numeric components compare as 0 — malformed input can never claim
// an update that isn't there.
pub fn compare(remote: &str, local: &str) -> i64 {
    let (a, b) = (parts(remote), parts(local));
    let len = a.len().max(b.len());
    let mut cmp = 0i64;
    for i in 0..len {
        cmp = (a.get(i).copied().unwrap_or(0) as i64)
            - (b.get(i).copied().unwrap_or(0) as i64);
        if cmp != 0 {
            return cmp;
        }
    }
    cmp
}

/// True when the remote release tag is strictly newer than the running app.
pub fn is_newer(remote: &str, local: &str) -> bool {
    !remote.is_empty() && !local.is_empty() && compare(remote, local) > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_ordering() {
        assert!(compare("1.10.0", "1.2.0") > 0);
        assert!(compare("1.2.0", "1.10.0") < 0);
        assert_eq!(compare("1.2.0", "1.2.0"), 0);
        assert!(compare("2.0.0", "1.99.99") > 0);
    }

    #[test]
    fn missing_parts_are_zero() {
        assert_eq!(compare("1.2", "1.2.0"), 0);
        assert!(compare("1.3", "1.2.9") > 0);
    }

    #[test]
    fn never_claims_phantom_updates() {
        // the OLD text-compare bug: an older tag reading as newer
        assert!(!is_newer("1.0.0", "1.2.0"));
        assert!(!is_newer("", "1.2.0"));
        assert!(!is_newer("1.3.0", ""));
        assert!(!is_newer("", ""));
        assert!(is_newer("1.3.0", "1.2.0"));
    }
}
