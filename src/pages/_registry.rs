use resuma::prelude::*;
use resuma::FlowPageRegistry;

pub struct PagesRegistry;

impl FlowPageRegistry for PagesRegistry {
    fn routes(&self) -> &'static [(&'static str, &'static str)] {
        &[("/", "index"), ("/about", "about")]
    }

    fn layout_for(&self, pattern: &str) -> &'static [&'static str] {
        match pattern {
            "/" | "/about" => &["/"],
            _ => &[],
        }
    }

    fn render(&self, module: &str, req: FlowRequest) -> Option<View> {
        match module {
            "index" => Some(super::index::page(req)),
            "about" => Some(super::about::page(req)),
            _ => None,
        }
    }
}
